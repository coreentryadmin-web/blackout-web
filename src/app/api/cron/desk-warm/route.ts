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
import { shouldRunCacheWarmer } from "@/lib/cache-warmer-gate";
import { warmFlowsMemberCaches } from "@/lib/flows-member-cache";
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
  if (!shouldRunCacheWarmer(force)) {
    const payload = {
      ok: true,
      skipped: true,
      reason:
        "Outside extended warm window (weekday 4:00 AM–8:00 PM ET) — use ?force=1 or set CACHE_WARM_ALWAYS=1",
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
    void runDeskWarm(started).catch((error) => {
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
