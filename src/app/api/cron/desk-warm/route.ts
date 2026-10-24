// Cron: pre-warm the shared SPX desk cache lanes (desk + flow + pulse) and the SPX
// GEX heatmap matrix used by the dashboard left rail.
// Schedule: ~every 5 min during RTH on ECS (5-minute floor); in-app rth-warm-leader
// backs up at ~90s when cron stalls (registered in cron-registry.ts as "desk-warm";
// ECS wires the fire via EventBridge scheduled rule).
//
// THE POINT: buildSpxDesk() is UW-bound (~2–5s cold). User polls hit loadSpxDesk() /
// loadMergedSpxDesk(), which share a single Redis/in-process cache with SWR. Without a
// warmer, the first member poll after each TTL expiry blocks on the full rebuild. This
// cron keeps those lanes hot so dashboard XHR stays sub-second during RTH.

import { NextRequest, NextResponse, after } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { loadBootstrapBundle, loadMergedSpxDesk } from "@/features/spx/lib/spx-desk-loader";
import { prefetchSpxDeskEnrichment } from "@/features/spx/lib/spx-desk";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { getUwCacheRedis } from "@/lib/providers/uw-shared-cache";
import { seedUwCacheFromWsStores } from "@/lib/uw-ws-cache-bridge";
import { callerInfoFromRequest, shouldRunCacheWarmer } from "@/lib/cache-warmer-gate";
import { isEtExtendedWarmHours } from "@/lib/et-market-hours";
import { warmFlowsMemberCaches } from "@/lib/flows-member-cache";
import { runWithBackgroundUwSweep } from "@/lib/providers/uw-rate-limiter";
import { sharedCacheDel, sharedCacheSetNx } from "@/lib/shared-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cross-replica overlap guard. Measured live on prod 2026-09-02: FOUR "[cron/desk-warm]
 * background done" completions logged within a 17.5s window (15:26:01.386-15:26:18.865 UTC),
 * each carrying elapsed=9-24s — i.e. multiple invocations of the same UW/Polygon-bound fan-out
 * (loadMergedSpxDesk + fetchGexHeatmap SPX/SPY + loadBootstrapBundle + warmFlowsMemberCaches)
 * were genuinely executing concurrently on shared web-tier ECS compute, contending for the same
 * rate-limited upstreams real member requests also depend on. This route has TWO independent,
 * uncoordinated trigger sources — EventBridge's own ~5min schedule AND the in-app rth-warm-leader
 * (rth-warm-leader.ts), which re-dispatches this key the instant its last recorded run is more
 * than 90s stale (RTH_WRITER_HEAL_AFTER_MIN["desk-warm"], the TIGHTEST heal threshold of any
 * watched key) — with no lock between them, so a fast EventBridge fire and a leader-triggered
 * heal-fire can land within seconds of each other while the prior run's background work is still
 * in flight. Same `sharedCacheSetNx` idempotent-skip pattern already used by vector-pick-sweep
 * for this exact problem shape. TTL (600s) matches this cron's own `stale_after_min: 10`
 * alerting threshold (cron-registry.ts) as the safety-net ceiling if a release is ever missed.
 */
const OVERLAP_LOCK_KEY = "desk-warm:running";
const OVERLAP_LOCK_TTL_SEC = 600;

/**
 * Minimum re-run floor — independent of, and IN ADDITION TO, the hours gate above.
 *
 * `force=1` is a COMPLETE bypass of `shouldRunCacheWarmer`'s hours check: cron-dispatch.ts marks
 * desk-warm `force: true` for every in-app dispatcher (rth-warm-leader, cron-staleness-watchdog
 * self-heal, admin/cron/run), and the same query param is documented as open to ANY CRON_SECRET
 * holder for on-demand/debug warms (cache-warmer-gate.ts). Nothing capped how OFTEN it could be
 * replayed — the only existing protection, OVERLAP_LOCK above, guards solely against a SECOND run
 * starting while the FIRST is still in flight, and is released the instant each run completes,
 * often well under a second on an already-warm cache. So a caller replaying `?force=1` in a tight
 * loop could re-trigger the full 5-way UW/Polygon-bound fan-out (loadMergedSpxDesk + 2x
 * fetchGexHeatmap + loadBootstrapBundle x2 + warmFlowsMemberCaches + prefetchSpxDeskEnrichment) as
 * fast as it could send requests, with nothing in the code capping the rate.
 *
 * Measured live 2026-09-04: 314 "[cron/desk-warm] background done" completions between 00:29 and
 * 07:59 UTC — deep overnight, weekday, entirely outside the 4:00 AM-8:00 PM ET extended-warm window
 * — median 40s apart (some under 15s). Positively ruled out, with direct CloudWatch evidence, as the
 * source: EventBridge (its rule fires every 5 minutes but ONLY inside the 11-21 UTC band, and its
 * hit-cron Lambda logged ZERO desk-warm invocations anywhere in the window), rth-warm-leader (its own
 * `isEtExtendedWarmHours` gate correctly kept it fully silent — zero "[rth-warm-leader]" log lines
 * of ANY kind — until exactly 08:00:02 UTC, the precise ET 4:00 AM boundary), and
 * cron-staleness-watchdog's self-heal (zero "self-heal"/"cron-staleness-watchdog" log lines all
 * night, and by construction `market_hours_stale` for a `market_hours_only` job cannot be true
 * outside cash RTH — see admin-cron-health.ts's `evaluateJob`). #3512 (14c5d815d5) correctly removed
 * the `CACHE_WARM_ALWAYS` bypass from the NORMAL (non-forced) path — that fix is intact and
 * verifiably working (the rth-warm-leader silence above proves the shared `isEtExtendedWarmHours`
 * gate is correct on the deployed image). This closes the SEPARATE, always-on `force=1` path that
 * fix never touched and that nothing was rate-limiting, so whatever external caller is invoking it
 * off-hours can no longer do so more than once per minute.
 *
 * 60s sits safely BELOW every legitimate cadence so it never blocks real traffic: rth-warm-leader's
 * own heal threshold for this key is 90s (RTH_WRITER_HEAL_AFTER_MIN["desk-warm"]) and EventBridge's
 * own schedule is every 5 min — neither path re-requests this key sooner than 60s ever would allow.
 *
 * OFF-WINDOW FLOOR (2026-09-07): the 60s floor above assumes the caller is a legitimate in-window
 * dispatcher whose OWN cadence is already >=60s apart, which is true for every in-app dispatcher
 * (rth-warm-leader, cron-staleness-watchdog self-heal) — each of those already gates on
 * `isEtExtendedWarmHours` (or the market-hours-stale flag, which is itself holiday-aware; see
 * admin-cron-health.ts) before ever calling this route, so they cannot fire at all outside the
 * window. Measured live 2026-09-07 (Labor Day, an NYSE full-day closure that falls on a weekday):
 * CloudWatch showed 166 "`force=1` bypassed the hours gate" log lines for this key in 6h, from 47+
 * distinct source IPs (`ua=node` — not any known in-app dispatcher, whose calls originate from the
 * small, stable set of ECS task IPs), each completing a real 5-94s UW/Polygon-bound fan-out — 70
 * full runs in that window alone, entirely on a day the market is closed and nothing should be
 * warming this cache. The 13:36-14:45 UTC cluster of these calls lines up with the SAME window's
 * measured `AWS/ApplicationELB` TargetResponseTime spike (p99 68s / Max 100s, against a 0.02s p50
 * the rest of the day) — the exact "low average, high p99/Max = one saturating background job"
 * signature this repo's standing perf-audit mandate describes, not a fleet-capacity problem. The
 * source of those calls was NOT traced to any script in THIS repo (`compare-latency-envs.mjs`,
 * `latency-burst-audit.mjs`, and `validate-deploy.mjs` all already gate on the holiday-aware
 * `isDeployCacheWarmAllowed` per #4489, merged 2026-09-07 15:38 UTC — well before the cluster above
 * — and `site-latency-audit.mjs`'s own force-warm helper is unconditionally `IS_STAGING`-gated,
 * which is always false against production) — so whatever the caller is, this route cannot assume
 * good faith about ITS cadence the way it can for the two known in-app dispatchers.
 *
 * Rather than chase an external caller this route has no way to identify, defend the route itself:
 * `force=1` still bypasses the HOURS gate immediately (a single on-demand/debug warm still works
 * exactly as before — the 60s floor already covers a legitimate one-off), but a REPEATED force=1
 * call made OUTSIDE the extended warm window is throttled at a much wider floor than one made
 * inside it, where a real dispatcher's own cadence already provides the discipline this floor
 * exists to enforce.
 */
const RERUN_COOLDOWN_KEY = "desk-warm:cooldown";
const RERUN_COOLDOWN_SEC = 60;
const OFF_WINDOW_FORCE_COOLDOWN_SEC = 300;

async function runDeskWarm(started: number): Promise<void> {
  try {
    const [mergedResult, gexResults, bootstrapResult, flowsWarmResult] = await Promise.allSettled([
      loadMergedSpxDesk(),
      Promise.allSettled(["SPX", "SPY"].map((t) => fetchGexHeatmap(t))),
      loadBootstrapBundle(),
      warmFlowsMemberCaches(),
    ]);

    try {
      const redis = await getUwCacheRedis();
      if (redis) await seedUwCacheFromWsStores(redis);
    } catch {
      /* non-fatal */
    }

    const deskOk = mergedResult.status === "fulfilled";
    const gexOk =
      gexResults.status === "fulfilled" &&
      gexResults.value.some((r) => r.status === "fulfilled");
    const bootstrapOk = bootstrapResult.status === "fulfilled";
    const flowsWarmOk =
      flowsWarmResult.status === "fulfilled" && (flowsWarmResult.value?.warmed ?? 0) > 0;

    let enrichOk = false;
    try {
      await prefetchSpxDeskEnrichment();
      enrichOk = true;
      await loadBootstrapBundle();
    } catch {
      enrichOk = false;
    }

    if (!deskOk) {
      console.warn(
        "[cron/desk-warm] background loadMergedSpxDesk failed:",
        mergedResult.status === "rejected" ? mergedResult.reason : "unknown"
      );
    }
    if (!gexOk) {
      console.warn(
        "[cron/desk-warm] background fetchGexHeatmap(SPX/SPY) failed:",
        gexResults.status === "rejected" ? gexResults.reason : "all tickers failed"
      );
    }

    console.info(
      `[cron/desk-warm] background done — desk=${deskOk} gex=${gexOk} bootstrap=${bootstrapOk} flowsWarm=${flowsWarmOk} enrich=${enrichOk} elapsed=${Date.now() - started}ms`
    );
  } finally {
    await sharedCacheDel(OVERLAP_LOCK_KEY).catch(() => undefined);
  }
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!shouldRunCacheWarmer(force, undefined, "desk-warm", callerInfoFromRequest(req))) {
    const payload = {
      ok: true,
      skipped: true,
      reason:
        "Outside extended warm window (weekday 4:00 AM–8:00 PM ET) — use ?force=1",
    };
    await logCronRun("desk-warm", started, payload);
    return NextResponse.json(payload);
  }

  // Rate floor — checked even when force=1 legitimately cleared the hours gate above (see
  // RERUN_COOLDOWN_KEY doc comment). Not deleted on completion like OVERLAP_LOCK below — it is
  // meant to persist for its full TTL so the cadence floor holds regardless of how fast each
  // individual run finishes. Widened OFF-window (see OFF_WINDOW_FORCE_COOLDOWN_SEC doc comment
  // above) — a legitimate in-app dispatcher never calls in this branch at all (both already gate
  // on the same holiday-aware hours check before dispatching), so anything reaching here outside
  // the window is either a one-off human debug hit (unaffected — it still runs immediately, same
  // as before) or a repeated external caller this route has no other way to defend against.
  const effectiveCooldownSec = isEtExtendedWarmHours()
    ? RERUN_COOLDOWN_SEC
    : OFF_WINDOW_FORCE_COOLDOWN_SEC;
  const withinCooldown = !(await sharedCacheSetNx(
    RERUN_COOLDOWN_KEY,
    { startedAt: started },
    effectiveCooldownSec
  ).catch(() => true)); // fail OPEN on a Redis error — same posture as OVERLAP_LOCK below
  if (withinCooldown) {
    const payload = {
      ok: true,
      skipped: true,
      reason: `rate-limited — desk-warm already ran within the last ${effectiveCooldownSec}s (force=1 does not bypass this floor)`,
    };
    await logCronRun("desk-warm", started, payload);
    return NextResponse.json(payload);
  }

  const acquired = await sharedCacheSetNx(
    OVERLAP_LOCK_KEY,
    { startedAt: started },
    OVERLAP_LOCK_TTL_SEC
  ).catch(() => true); // fail OPEN on a Redis error — a missed overlap guard is safer than a stuck cron
  if (!acquired) {
    const payload = {
      ok: true,
      skipped: true,
      reason: "previous desk warm still in flight (idempotent skip)",
    };
    await logCronRun("desk-warm", started, payload);
    return NextResponse.json(payload);
  }

  const dispatchWarm = () => {
    void runWithBackgroundUwSweep(() => runDeskWarm(started)).catch((error) => {
      console.error("[cron/desk-warm] background warm REJECTED:", error);
    });
  };

  try {
    after(dispatchWarm);
  } catch {
    dispatchWarm();
  }

  const accepted = {
    ok: true,
    status: "accepted",
    reason: "desk + gex + bootstrap warm dispatched in background (fire-and-forget)",
  };
  await logCronRun("desk-warm", started, accepted);
  return NextResponse.json(
    {
      ...accepted,
      note: "Heavy warm runs in background — SPX desk lanes still advance on the ECS worker.",
    },
    { status: 202 }
  );
}
