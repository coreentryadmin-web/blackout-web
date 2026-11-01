import "server-only";
import { dbConfigured, dbQuery } from "@/lib/db";
import {
  buildProviderHealthIssues,
  clampProviderHealthWindowMinutes,
  type ProviderTelemetryRollup,
} from "@/lib/provider-health-issues";

export {
  PROVIDER_HEALTH_CATEGORY,
  buildProviderHealthIssues,
  DEFAULT_PROVIDER_HEALTH_THRESHOLDS,
} from "@/lib/provider-health-issues";
export type { ProviderTelemetryRollup, ProviderHealthThresholds } from "@/lib/provider-health-issues";

export async function fetchProviderTelemetryRollups(
  windowMinutes = 10
): Promise<ProviderTelemetryRollup[]> {
  if (!dbConfigured()) return [];
  const mins = clampProviderHealthWindowMinutes(windowMinutes);
  try {
    const { rows } = await dbQuery<{
      provider: string;
      calls: string;
      failures: string;
      rate_limits: string;
      top_endpoints: string[] | null;
    }>(
      `WITH recent AS (
         SELECT provider, endpoint, ok, rate_limited
         FROM api_telemetry_events
         WHERE at > NOW() - ($1 || ' minutes')::interval
       ),
       agg AS (
         SELECT
           provider,
           COUNT(*)::int AS calls,
           COUNT(*) FILTER (WHERE ok = false AND rate_limited = false)::int AS failures,
           COUNT(*) FILTER (WHERE rate_limited = true)::int AS rate_limits
         FROM recent
         GROUP BY provider
       ),
       tops AS (
         SELECT provider, array_agg(endpoint ORDER BY n DESC) AS top_endpoints
         FROM (
           SELECT provider, endpoint, COUNT(*)::int AS n
           FROM recent
           WHERE ok = false AND rate_limited = false
           GROUP BY provider, endpoint
         ) x
         GROUP BY provider
       )
       SELECT
         a.provider,
         a.calls::text,
         a.failures::text,
         a.rate_limits::text,
         COALESCE(t.top_endpoints[1:3], ARRAY[]::text[]) AS top_endpoints
       FROM agg a
       LEFT JOIN tops t ON t.provider = a.provider
       WHERE a.failures > 0 OR a.rate_limits > 0
       ORDER BY a.failures DESC, a.calls DESC`,
      [String(mins)]
    );

    return rows.map((r) => ({
      provider: r.provider,
      calls: Number(r.calls),
      failures: Number(r.failures),
      rate_limits: Number(r.rate_limits),
      top_endpoints: r.top_endpoints ?? [],
    }));
  } catch (err) {
    console.warn("[provider-health-reconcile] telemetry query failed:", err);
    return [];
  }
}

export async function runProviderHealthReconcile(windowMinutes = 10): Promise<{
  rollups: ProviderTelemetryRollup[];
  issues: ReturnType<typeof buildProviderHealthIssues>;
  /**
   * The SAME clamped value the rollup query and issue text actually used — returned so the
   * cron route can report/log THIS number instead of its own raw, possibly non-finite
   * `windowMinutes` argument. Before this field existed, `app/api/cron/provider-health-reconcile/
   * route.ts` built its `window_min` log/response field from `Number(process.env.
   * PROVIDER_HEALTH_WINDOW_MIN ?? "10")` directly — the exact non-numeric-env-override shape this
   * module's own `clampProviderHealthWindowMinutes` NaN guard exists to catch (see its doc
   * comment), but that guard was only ever applied to the QUERY window and the issue TEXT, never
   * to this third, separate exposure point. A misconfigured `PROVIDER_HEALTH_WINDOW_MIN` (e.g.
   * empty string or non-numeric) would make every real window usage correctly fall back to the
   * 10-minute default while the cron's own `window_min` field — written to `cron_job_runs` and
   * returned in the HTTP JSON response — still showed the raw `NaN`, exactly the "member/admin
   * sees a raw NaN" defect class already fixed everywhere else this value is used.
   */
  effectiveWindowMinutes: number;
}> {
  // Reuse the SAME clamped value the rollup query actually applied (not the
  // raw, possibly out-of-range `windowMinutes` argument) — otherwise an env
  // override outside [1, 60] (e.g. PROVIDER_HEALTH_WINDOW_MIN=120) would make
  // the issue text claim a window the SQL query never used.
  const effectiveWindowMinutes = clampProviderHealthWindowMinutes(windowMinutes);
  const rollups = await fetchProviderTelemetryRollups(windowMinutes);
  const issues = buildProviderHealthIssues(rollups, undefined, effectiveWindowMinutes);
  return { rollups, issues, effectiveWindowMinutes };
}
