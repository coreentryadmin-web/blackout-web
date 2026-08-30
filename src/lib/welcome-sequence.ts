import { dbConfigured, dbQuery } from "@/lib/db";
import { sendEmail } from "@/lib/email/resend-client";
import { WELCOME_SEQUENCE } from "@/lib/email/templates/welcome-sequence";
import { syncResendContact } from "@/lib/resend-contacts";
import { isInternalAuditEmail } from "@/lib/internal-audit-email";

const STEP_GAP_DAYS = 2;
const TOTAL_STEPS = WELCOME_SEQUENCE.length;

/**
 * How far past due a step may be and still be worth sending.
 *
 * The drip is a WELCOME sequence — every step is written for someone in their first ~8 days
 * ("eight days of watching is enough", "get your bearings, fast"). Sent a month late to someone
 * who has been using the desk since, it reads as broken software, and the reader is right.
 *
 * This matters because the cron can be unscheduled for a long stretch: it was never wired into
 * production at all until 2026-08-08, so on first run every existing row was due at once. Without
 * a cutoff, turning the cron on flushes that whole backlog as real mail — a burst of stale,
 * contextless emails to the existing member base, which is a spam-complaint event, and complaint
 * rate is the one metric Gmail/Yahoo suspend bulk senders over.
 *
 * Stale rows are marked COMPLETE, not deleted and not retried: the member simply exits the drip
 * where they are. 7 days ≈ 3 step gaps, so a normal blip (a few missed hourly runs, a short
 * outage) still delivers, while a genuinely abandoned schedule doesn't dump on anyone.
 */
const MAX_STEP_LATENESS_DAYS = 7;

// Injectable deps (default to the real modules) — same pattern as referrals.ts's
// Deps type: lets tests pass fakes directly instead of fighting ESM module mocking.
type Deps = {
  dbConfigured: typeof dbConfigured;
  dbQuery: typeof dbQuery;
  sendEmail: typeof sendEmail;
  syncResendContact: typeof syncResendContact;
};
const defaultDeps: Deps = { dbConfigured, dbQuery, sendEmail, syncResendContact };

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

    // Fire-and-forget — a contact-sync hiccup must never block or fail the welcome
    // send. Tier is "free" here: this fires straight off Clerk's user.created,
    // before any billing has happened. billing-lifecycle-email.ts's transition
    // wrapper re-syncs to the correct tier/segment the moment that changes.
    void deps.syncResendContact({ email: input.email, firstName: input.firstName, tier: "free" }).catch(() => undefined);

    const { subject, html, attachments, headers } = firstStep.build({ email: input.email, firstName: input.firstName });
    const result = await deps.sendEmail({
      to: input.email,
      subject,
      html,
      attachments,
      headers,
      tag: `welcome-step-${firstStep.step}`,
      topicId: process.env.RESEND_TOPIC_MARKETING_ID,
    });

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
    // Retire anything too far past due BEFORE selecting work, so a long-unscheduled cron cannot
    // flush a backlog of stale welcome mail on its first run. Unbounded by design: this is a
    // cheap indexed UPDATE, and leaving stale rows behind would just re-surface them next run.
    const retired = await deps.dbQuery(
      `UPDATE welcome_sequence_state
       SET completed_at = NOW(), next_send_at = NULL
       WHERE completed_at IS NULL
         AND next_send_at IS NOT NULL
         AND next_send_at < NOW() - ($1 || ' days')::interval`,
      [String(MAX_STEP_LATENESS_DAYS)]
    );
    if ((retired.rowCount ?? 0) > 0) {
      console.warn(
        `[welcome-sequence] retired ${retired.rowCount} row(s) more than ${MAX_STEP_LATENESS_DAYS} days past due — not sending stale welcome mail`
      );
    }

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

      // `startWelcomeSequence`'s caller (the Clerk webhook) skips this INSERT for a recognized
      // audit/test-harness account, but that gate only covers rows created AFTER it shipped
      // (2026-08-28) — rows from the ~30 ad-hoc harnesses that predate it are already sitting in
      // this table. Left unchecked, this cron retries them EVERY hour for up to
      // MAX_STEP_LATENESS_DAYS (Resend rejects `@example.com` etc. with a 422, and a failed send
      // deliberately leaves next_send_at untouched so the next run retries the SAME step) — see
      // this file's own MAX_STEP_LATENESS_DAYS comment on why a high bounce rate on a
      // transactional template is a sender-reputation risk, not just wasted send volume. Marking
      // complete here (not deleted, not retried) matches the retirement/defensive-branch pattern
      // below rather than inventing a third way to exit the drip.
      if (isInternalAuditEmail(row.email)) {
        await deps.dbQuery(
          `UPDATE welcome_sequence_state SET completed_at = NOW(), next_send_at = NULL WHERE user_id = $1`,
          [row.user_id]
        );
        continue;
      }

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

      const { subject, html, attachments, headers } = step.build({ email: row.email, firstName: row.first_name });
      const sendResult = await deps.sendEmail({
        to: row.email,
        subject,
        html,
        attachments,
        headers,
        tag: `welcome-step-${step.step}`,
        topicId: process.env.RESEND_TOPIC_MARKETING_ID,
      });

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
