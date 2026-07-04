// BIE Stage 2 "missed alerts" — ground truth = cron-outage only: "we know we
// didn't evaluate," never "we evaluated and missed a real setup." The latter
// would need a full historical backtest re-scoring pass against past market
// data — a much bigger, genuinely separate build, deliberately out of scope
// here (see docs/bie/FULL-SYSTEM-AWARENESS.md Stage 2). Built entirely from
// data BIE already reads (cron_job_runs via admin-cron-health.ts's
// schedule-aware health engine) — no new schema, no new access, no invented
// definition beyond "an alert-producing cron was down during the window it's
// supposed to be live."

import { CRON_JOBS } from "@/lib/cron-registry";

/** Derived from cron-registry.ts's `produces_member_alert` flag — single source of truth,
 *  so a new alert-producing cron can't silently go unmonitored the way `nighthawk-morning-
 *  confirm` did when this was a hand-maintained 3-entry list. */
export const ALERT_PRODUCING_CRON_KEYS: readonly string[] = CRON_JOBS.filter(
  (j) => j.produces_member_alert
).map((j) => j.key);

/** The only fields this module reads from admin-cron-health's CronJobHealth —
 *  narrowed on purpose, same pattern as discovery.ts's DiscoveryCronJob, so
 *  this stays independently testable without that engine's full shape. */
export type MissedAlertCronJob = {
  key: string;
  status: "healthy" | "warning" | "stale" | "failed" | "unknown";
  status_label: string;
  market_hours_stale: boolean;
};

export type MissedAlertWindow = {
  job_key: string;
  status: MissedAlertCronJob["status"];
  status_label: string;
};

export type MissedAlertsSummary = {
  outage_count: number;
  windows: MissedAlertWindow[];
};

/** Pure: which alert-producing crons are currently down during RTH — either a
 *  logged failure, or stale specifically because the market is open and this
 *  job should be ticking (admin-cron-health.ts's market_hours_stale flag,
 *  which is already false outside RTH by construction of that engine, so
 *  off-hours staleness is never flagged here either). */
export function detectMissedAlertWindows(
  jobs: MissedAlertCronJob[],
  alertProducingKeys: readonly string[] = ALERT_PRODUCING_CRON_KEYS
): MissedAlertsSummary {
  const windows = jobs
    .filter((j) => alertProducingKeys.includes(j.key))
    .filter((j) => j.status === "failed" || j.market_hours_stale)
    .map((j) => ({ job_key: j.key, status: j.status, status_label: j.status_label }));
  return { outage_count: windows.length, windows };
}
