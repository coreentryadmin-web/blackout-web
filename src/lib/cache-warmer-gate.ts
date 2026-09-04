import { isEtExtendedWarmHours } from "@/lib/et-market-hours";

/**
 * Whether a cache-warmer cron should run upstream fetches (desk/gex/zerodte/heatmap).
 *
 * `CACHE_WARM_ALWAYS` USED TO bypass the hours gate — it was a staging-only knob so
 * EventBridge ticks kept caches hot off cash RTH there too. Staging (the only intended
 * consumer) was fully decommissioned 2026-07-25, but the production `blackout-production/app/env`
 * secret still carries `CACHE_WARM_ALWAYS=1` as a leftover — confirmed live 2026-09-04 via
 * Secrets Manager. That leftover was making all FOUR warm crons that share this gate
 * (desk-warm, zerodte-warm, heatmap-warm, meridian-warm) bypass `isEtExtendedWarmHours` and run
 * continuously 24/7, including deep overnight hours with no member traffic to warm caches for.
 * Measured impact (2026-09-04, 6h overnight window): `desk-warm` alone logged 40+
 * `elapsed=`10-33s background runs between 00:21-06:18 UTC (all outside the 4am-8pm ET window),
 * `AWS/ECS` CPUUtilization on `blackout-production-web` spiked Max 80-90% in nearly every 15-min
 * bucket against a 2-8% average (the single-task saturation signature of a periodic CPU-bound
 * burst, not fleet load), and `AWS/ApplicationELB` TargetResponseTime on the same window showed
 * p50/p90 healthy (37-377ms) but p99 1.7-3.6s and Max 9-41s — the exact "low average, high
 * p99/Max = tail latency, not capacity" pattern this repo's standing perf-audit mandate names.
 * Removed the escape hatch entirely rather than special-casing "ignore it in production": it has
 * no live consumer now, and keeping a knob nobody is supposed to set is how it gets set again.
 * `force=1` remains for legitimate on-demand/debug warms.
 */
export function shouldRunCacheWarmer(force: boolean, now = new Date()): boolean {
  if (force) return true;
  return isEtExtendedWarmHours(now);
}
