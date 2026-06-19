import { recordCronJobRun } from "@/lib/db";

export type CronRunPayload = {
  ok?: boolean;
  /** When true, marks the cron run as intentionally skipped (not a failure). */
  skipped?: boolean;
  error?: string;
  reason?: string;
  [key: string]: unknown;
};

export async function logCronRun(
  jobKey: string,
  startedMs: number,
  result: CronRunPayload
): Promise<void> {
  const status = result.skipped === true ? "skipped" : result.ok === false ? "failed" : "ok";
  const message = String(
    result.error ?? result.reason ?? (result.skipped ? "skipped" : status === "ok" ? "ok" : "failed")
  ).slice(0, 500);

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
}
