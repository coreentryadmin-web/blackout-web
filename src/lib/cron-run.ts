import { recordCronJobRun } from "@/lib/db";
import { notifyOpsDiscord } from "@/features/spx/lib/spx-play-notify";

export type CronRunPayload = {
  ok?: boolean;
  /** When true, marks the cron run as intentionally skipped (not a failure). */
  skipped?: boolean;
  error?: string;
  reason?: string;
  /**
   * Several crons (db-cleanup among them) report per-item failures as a PLURAL array instead of
   * (or in addition to) a singular `error`/`reason` string — see `deriveCronRunStatus` below for
   * why this needs its own fallback rather than being silently dropped.
   */
  errors?: unknown;
  [key: string]: unknown;
};

/** One plural-`errors` array entry this can usefully summarize into one line of text. */
type SummarizableError = string | { table?: unknown; error?: unknown; [key: string]: unknown };

/**
 * `db-cleanup`'s payload (`{ ok: false, errors: [{table, error}] }`) has NO singular
 * `error`/`reason` field — only this plural array. Root-caused 2026-09-12: a real deadlock
 * failure on `vector_wall_history` produced a "Cron failure: db-cleanup" Discord alert whose body
 * was the bare, contentless word `"failed"`, because the derivation below only ever read
 * `result.error`/`result.reason`. Diagnosing that alert required going straight to CloudWatch
 * instead of the alert itself. Summarize the first few entries so the alert carries the actual
 * table + Postgres error text the caller already computed, instead of discarding it.
 */
function summarizePluralErrors(errors: unknown): string | null {
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const MAX_SHOWN = 5;
  const parts = (errors as SummarizableError[]).slice(0, MAX_SHOWN).map((e) => {
    if (typeof e === "string") return e;
    if (e && typeof e === "object") {
      const table = typeof e.table === "string" ? e.table : undefined;
      const error = typeof e.error === "string" ? e.error : undefined;
      if (table && error) return `${table}: ${error}`;
      if (error) return error;
    }
    return String(e);
  });
  const more = errors.length > MAX_SHOWN ? ` (+${errors.length - MAX_SHOWN} more)` : "";
  return parts.join("; ") + more;
}

/**
 * Pure: derive the {status, message} pair used both for the `cron_job_runs` DB row and the
 * Discord failure alert. Split out from `logCronRun` so this derivation is directly unit
 * testable (logCronRun itself talks to Postgres + Discord, which would require mocking both just
 * to test a string-formatting decision).
 */
export function deriveCronRunStatus(
  result: CronRunPayload
): { status: "ok" | "skipped" | "failed"; message: string } {
  const status = result.skipped === true ? "skipped" : result.ok === false ? "failed" : "ok";
  const message = String(
    result.error ??
      result.reason ??
      summarizePluralErrors(result.errors) ??
      (result.skipped ? "skipped" : status === "ok" ? "ok" : "failed")
  ).slice(0, 500);
  return { status, message };
}

export async function logCronRun(
  jobKey: string,
  startedMs: number,
  result: CronRunPayload
): Promise<void> {
  const { status, message } = deriveCronRunStatus(result);

  try {
    await recordCronJobRun({
      job_key: jobKey,
      status,
      duration_ms: Date.now() - startedMs,
      message,
      meta_json: result,
    });
  } catch (err) {
    console.warn(`[cron-run/${jobKey}] log failed:`, err);
  }

  if (status === "failed") {
    void notifyOpsDiscord({
      title: `Cron failure: ${jobKey}`,
      body: `\`${message}\`\nDuration: ${Date.now() - startedMs}ms`,
      severity: "critical",
    }).catch(() => undefined);
  }
}
