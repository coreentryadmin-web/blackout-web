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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function runDeskWarm(started: number): Promise<void> {
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
