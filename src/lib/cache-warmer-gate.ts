import type { NextRequest } from "next/server";
import { isEtExtendedWarmHours } from "@/lib/et-market-hours";
import { getClientIp } from "@/lib/ip-rate-limit";

/** Client IP + user-agent, for the `callerInfo` param below — built once here so all four
 *  warm-cron routes stay consistent instead of four copies of the same header reads. */
export function callerInfoFromRequest(req: NextRequest): string {
  const ip = getClientIp(req);
  const ua = req.headers.get("user-agent")?.trim() || "no-ua";
  return `ip=${ip} ua=${ua}`;
}

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
 *
 * OBSERVABILITY: `force=1` bypassing an active hours-block reproduces the exact same
 * upstream-saturation shape as the `CACHE_WARM_ALWAYS` bug above (a warm cron running off real
 * member-traffic hours) through a legitimate mechanism this gate can't remove — on-demand/debug
 * warms are supposed to be able to override the window. What was missing is which cron and how
 * often: nothing logged a force-driven off-hours run, so a NEW unmonitored caller hammering
 * `?force=1` overnight (a leftover debug habit, a misconfigured health check, an in-app dispatcher
 * whose own gate has a bug) would recreate the same tail-latency/CPU-burst pattern with zero trace
 * of who triggered it — undiagnosable the same way CACHE_WARM_ALWAYS was until Secrets Manager was
 * checked by hand. Every bypass now logs its key so the next investigation is one log grep away.
 *
 * CALLER IDENTITY (2026-09-05): logging the key alone answered "which cron" but not "who" — this
 * bug's own prediction above ("a NEW unmonitored caller hammering ?force=1 overnight") reproduced
 * live: `desk-warm` measured 81 force-driven off-hours completions in 3 hours overnight (median
 * well under the 5-min legitimate EventBridge cadence), while EventBridge (11-21 UTC weekdays
 * only), `rth-warm-leader`, and `cron-staleness-watchdog` self-heal were all independently
 * confirmed silent for the same window (see `desk-warm/route.ts`'s `RERUN_COOLDOWN_KEY` doc
 * comment) — i.e. the caller is provably NOT any known in-app dispatcher, yet nothing captured
 * enough to identify it. `callerInfo` (client IP + user-agent, built by each route from the
 * request it already has) closes that gap so the NEXT investigation doesn't hit the same dead end.
 */
export function shouldRunCacheWarmer(
  force: boolean,
  now = new Date(),
  key?: string,
  callerInfo?: string
): boolean {
  if (force) {
    if (!isEtExtendedWarmHours(now)) {
      console.info(
        `[cache-warmer-gate] force=1 bypassed the hours gate${key ? ` for '${key}'` : ""}` +
          `${callerInfo ? ` (caller: ${callerInfo})` : ""} at ${now.toISOString()}`
      );
    }
    return true;
  }
  return isEtExtendedWarmHours(now);
}
