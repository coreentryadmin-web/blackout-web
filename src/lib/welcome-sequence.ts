import { dbConfigured, dbQuery } from "@/lib/db";
import { sendEmail } from "@/lib/email/resend-client";
import { WELCOME_SEQUENCE } from "@/lib/email/templates/welcome-sequence";

const STEP_GAP_DAYS = 2;
const TOTAL_STEPS = WELCOME_SEQUENCE.length;

// Injectable deps (default to the real modules) — same pattern as referrals.ts's
// Deps type: lets tests pass fakes directly instead of fighting ESM module mocking.
type Deps = {
  dbConfigured: typeof dbConfigured;
  dbQuery: typeof dbQuery;
  sendEmail: typeof sendEmail;
};
const defaultDeps: Deps = { dbConfigured, dbQuery, sendEmail };

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/**
 * Called once, from the Clerk user.created webhook. Sends step 1 (day 0)
 * immediately and schedules step 2 for STEP_GAP_DAYS later. Idempotent —
 * ON CONFLICT (user_id) DO NOTHING means a duplicate webhook delivery for
 * the same user never restarts or double-sends the sequence.
 */
export async function startWelcomeSequence(
  input: { userId: string; email: string; firstName?: string | null },
  deps: Deps = defaultDeps
): Promise<void> {
  if (!input.email) return;
  if (!deps.dbConfigured()) return;
  const firstStep = WELCOME_SEQUENCE[0];
  if (!firstStep) return;

  try {
    const res = await deps.dbQuery<{ id: number }>(
      `INSERT INTO welcome_sequence_state (user_id, email, first_name, steps_sent, next_send_at)
       VALUES ($1, $2, $3, 0, NOW())
       ON CONFLICT (user_id) DO NOTHING
       RETURNING id`,
      [input.userId, input.email, input.firstName ?? null]
    );
    if ((res.rowCount ?? 0) === 0) return; // already started for this user — no-op

    const { subject, html } = firstStep.build({ firstName: input.firstName });
    const result = await deps.sendEmail({ to: input.email, subject, html });

    const nextStep = WELCOME_SEQUENCE[1];
    await deps.dbQuery(
      `UPDATE welcome_sequence_state
       SET steps_sent = $2, next_send_at = $3, completed_at = $4
       WHERE user_id = $1`,
      [
        input.userId,
        result.ok ? 1 : 0, // a failed send doesn't advance — the cron will retry step 1
        nextStep ? daysFromNow(STEP_GAP_DAYS) : null,
        nextStep ? null : new Date(),
      ]
    );
  } catch (err) {
    console.warn("[welcome-sequence] startWelcomeSequence failed", err);
  }
}

export type ProcessDueResult = { processed: number; sent: number; failed: number };

/**
 * Cron entry point (src/app/api/cron/welcome-sequence/route.ts). Finds every
 * row whose next step is due, sends it, and advances state. Bounded per run
 * (limit) so a large backlog after downtime doesn't blow the cron's time
 * budget in one invocation — the next scheduled run picks up the rest.
 */
export async function processDueWelcomeSequenceSteps(
  limit = 200,
  deps: Deps = defaultDeps
): Promise<ProcessDueResult> {
  const result: ProcessDueResult = { processed: 0, sent: 0, failed: 0 };
  if (!deps.dbConfigured()) return result;

  try {
    const due = await deps.dbQuery<{
      user_id: string;
      email: string;
      first_name: string | null;
      steps_sent: number;
    }>(
      `SELECT user_id, email, first_name, steps_sent
       FROM welcome_sequence_state
       WHERE completed_at IS NULL AND next_send_at IS NOT NULL AND next_send_at <= NOW()
       ORDER BY next_send_at ASC
       LIMIT $1`,
      [limit]
    );

    for (const row of due.rows) {
      result.processed++;
      const nextIndex = row.steps_sent; // 0-based: steps_sent=1 means step 1 done, next is index 1 (step 2)
      const step = WELCOME_SEQUENCE[nextIndex];
      if (!step) {
        // Defensive — steps_sent somehow exceeded the sequence length. Mark complete
        // rather than looping on a row that can never match a real step again.
        await deps.dbQuery(
          `UPDATE welcome_sequence_state SET completed_at = NOW(), next_send_at = NULL WHERE user_id = $1`,
          [row.user_id]
        );
        continue;
      }

      const { subject, html } = step.build({ firstName: row.first_name });
      const sendResult = await deps.sendEmail({ to: row.email, subject, html });

      if (!sendResult.ok) {
        result.failed++;
        // Leave next_send_at as-is (in the past) so the NEXT cron run retries this
        // same step rather than silently skipping it or advancing past a failure.
        continue;
      }

      result.sent++;
      const newStepsSent = row.steps_sent + 1;
      const nextStep = WELCOME_SEQUENCE[newStepsSent];
      await deps.dbQuery(
        `UPDATE welcome_sequence_state
         SET steps_sent = $2, next_send_at = $3, completed_at = $4
         WHERE user_id = $1`,
        [
          row.user_id,
          newStepsSent,
          nextStep ? daysFromNow(STEP_GAP_DAYS) : null,
          nextStep ? null : new Date(),
        ]
      );
    }
  } catch (err) {
    console.warn("[welcome-sequence] processDueWelcomeSequenceSteps failed", err);
  }

  return result;
}

export { TOTAL_STEPS };
