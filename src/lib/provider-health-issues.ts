import type { SpxAdminIssue } from "@/lib/admin-spx-issues";

export const PROVIDER_HEALTH_CATEGORY = "provider-health";

export type ProviderTelemetryRollup = {
  provider: string;
  calls: number;
  failures: number;
  rate_limits: number;
  top_endpoints: string[];
};

export type ProviderHealthThresholds = {
  failWarn: number;
  failCrit: number;
  minCallsForRate: number;
  rateWarnPct: number;
  rateLimitWarn: number;
};

export const DEFAULT_PROVIDER_HEALTH_THRESHOLDS: ProviderHealthThresholds = {
  failWarn: 5,
  failCrit: 15,
  minCallsForRate: 10,
  rateWarnPct: 0.2,
  rateLimitWarn: 3,
};

/** Fallback window when the caller-supplied value is unusable (see the NaN guard below). */
export const DEFAULT_PROVIDER_HEALTH_WINDOW_MINUTES = 10;

/**
 * The rollup query (`fetchProviderTelemetryRollups` in provider-health-reconcile.ts)
 * clamps its caller-supplied window to [1, 60] minutes before building the SQL
 * `at > NOW() - (N || ' minutes')::interval` predicate. `buildProviderHealthIssues`
 * doesn't run its own query, so it has no way to know what window actually produced
 * the rows it's given unless a caller tells it the SAME clamped number — exported so
 * provider-health-reconcile.ts can apply it once and reuse the identical value for
 * both the query and the issue text, instead of two independent clamps drifting.
 *
 * NON-FINITE GUARD (bug found during the standing audit sweep). The route's only real caller
 * builds its argument via `Number(process.env.PROVIDER_HEALTH_WINDOW_MIN ?? "10")` — the exact
 * "non-numeric env override" shape this codebase already guards explicitly in
 * alert-outcome-sync/nighthawk-outcomes/largo-cleanup (`Number("abc")` is `NaN`, which silently
 * defeats a clamp that assumes a real number). This clamp did NOT have that guard:
 * `Math.round(NaN)` is `NaN`, and `Math.max`/`Math.min` propagate a `NaN` operand rather than
 * ignoring it, so `clampProviderHealthWindowMinutes(NaN)` returned `NaN`, not a value in [1, 60].
 * Two observable consequences of a misconfigured `PROVIDER_HEALTH_WINDOW_MIN`:
 *  1. `fetchProviderTelemetryRollups` builds `($1 || ' minutes')::interval` with `$1 = "NaN"` —
 *     not a valid Postgres interval literal, so the query throws, is caught, and the cron
 *     silently returns zero rollups/issues every run — the provider-health monitor goes dark
 *     with no error surfaced anywhere.
 *  2. Even where a raw `NaN` window label flows through unclamped (e.g. a future caller that
 *     skips the query path), `buildProviderHealthIssues`' `windowLabel` interpolates it directly
 *     into admin-facing issue text ("the last NaNm window"), the same "member/admin sees a raw
 *     NaN" defect class already fixed elsewhere in this codebase (fmt-money.ts's NaN guards).
 * Falling back to the same 10-minute default every other caller already uses when the argument
 * is omitted keeps this one function the single source of truth for both the query window and
 * the issue text, exactly as its own header above already requires.
 */
export function clampProviderHealthWindowMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_PROVIDER_HEALTH_WINDOW_MINUTES;
  return Math.min(Math.max(1, Math.round(minutes)), 60);
}

/** Pure mapper — exported for tests. */
export function buildProviderHealthIssues(
  rollups: ProviderTelemetryRollup[],
  thresholds: ProviderHealthThresholds = DEFAULT_PROVIDER_HEALTH_THRESHOLDS,
  windowMinutes = 10
): SpxAdminIssue[] {
  const issues: SpxAdminIssue[] = [];
  const windowLabel = `the last ${windowMinutes}m window`;

  for (const row of rollups) {
    const failRate = row.calls > 0 ? row.failures / row.calls : 0;
    const endpoints = row.top_endpoints.slice(0, 3).join(", ") || "n/a";
    const baseDetail = `${row.failures} fail / ${row.calls} call(s) in ${windowLabel} · top: ${endpoints}`;

    if (row.failures >= thresholds.failCrit) {
      issues.push({
        id: `${PROVIDER_HEALTH_CATEGORY}:${row.provider}:failures`,
        severity: "critical",
        category: PROVIDER_HEALTH_CATEGORY,
        title: `${row.provider} upstream failures`,
        detail: baseDetail,
      });
    } else if (
      row.failures >= thresholds.failWarn ||
      (row.calls >= thresholds.minCallsForRate && failRate >= thresholds.rateWarnPct)
    ) {
      issues.push({
        id: `${PROVIDER_HEALTH_CATEGORY}:${row.provider}:failures`,
        severity: "warning",
        category: PROVIDER_HEALTH_CATEGORY,
        title: `${row.provider} upstream errors elevated`,
        detail: `${baseDetail} · fail rate ${Number.isFinite(failRate) ? (failRate * 100).toFixed(1) : "—"}%`,
      });
    }

    if (row.rate_limits >= thresholds.rateLimitWarn) {
      issues.push({
        id: `${PROVIDER_HEALTH_CATEGORY}:${row.provider}:rate-limit`,
        severity: "warning",
        category: PROVIDER_HEALTH_CATEGORY,
        title: `${row.provider} rate limits`,
        detail: `${row.rate_limits} rate-limited call(s) in ${windowLabel}`,
      });
    }
  }

  return issues;
}
