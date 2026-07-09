// Cron: pre-warm ALL member-facing tool caches (desk, heatmap, vector, zerodte, flows).
// Schedule: every 5 min 24/7 on AWS EventBridge (off-hours gated by CACHE_WARM_OFF_HOURS=1).
//
// THE POINT: SPX desk was not the only cold path — Vector SSR (seed bars + wall scope),
// universe snapshot, dark-pool levels, and 0DTE board each block first paint when their
// lane expires. One coordinated warm keeps the whole site on hot-cache reads.

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { isEtCashRth } from "@/lib/et-market-hours";
import { vectorWarmTickers, vectorUniverseTickers } from "@/lib/heatmap-allowlist";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import {
  loadBootstrapBundle,
  loadMergedSpxDesk,
  loadSpxDeskFlow,
  loadSpxDeskPulse,
} from "@/features/spx/lib/spx-desk-loader";
import { prefetchSpxDeskEnrichment } from "@/features/spx/lib/spx-desk";
import { dbConfigured, fetchRecentFlows } from "@/lib/db";
import { fetchMarketFlowAlerts } from "@/lib/providers/unusual-whales";
import { serverCache, TTL } from "@/lib/server-cache";
import { fetchVectorSeedBars, primeVectorWallScope, refreshVectorUniverseSnapshot } from "@/features/vector";
import { warmVectorDarkPool } from "@/features/vector/lib/vector-dark-pool-cache";
import { warmGridEarnings } from "@/lib/zerodte/earnings";
import { warmZeroDteBoard } from "@/lib/zerodte/scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  const offHoursWarm = process.env.CACHE_WARM_OFF_HOURS?.trim() === "1";
  if (!force && !offHoursWarm && !isEtCashRth()) {
    const payload = {
      ok: true,
      skipped: true,
      reason: "Outside cash RTH — use ?force=1 or CACHE_WARM_OFF_HOURS=1",
    };
    await logCronRun("platform-warm", started, payload);
    return NextResponse.json(payload);
  }

  const heatmapTickers = vectorWarmTickers();
  const darkPoolTickers = vectorUniverseTickers();

  async function warmFlowsLane() {
    if (!dbConfigured()) {
      await serverCache("flows:uw:500:all:0", TTL.DARK_POOL, () =>
        fetchMarketFlowAlerts({ limit: 500 })
      );
      return;
    }
    await serverCache("flows:pg:168:0:all", TTL.DARK_POOL, async () => {
      const flows = await fetchRecentFlows({ limit: 500, since_hours: 168, order: "recent" });
      return { source: "cache" as const, flows, count: flows.length, platform_refs: { spx: null, nighthawk: null } };
    });
  }

  const results = await Promise.allSettled([
    loadBootstrapBundle(),
    loadMergedSpxDesk(),
    loadSpxDeskPulse(),
    loadSpxDeskFlow(),
    prefetchSpxDeskEnrichment(),
    warmFlowsLane(),
    ...heatmapTickers.map((t) => fetchGexHeatmap(t)),
    fetchVectorSeedBars("SPX"),
    primeVectorWallScope("SPX"),
    refreshVectorUniverseSnapshot(),
    ...darkPoolTickers.map((t) => warmVectorDarkPool(t)),
    warmGridEarnings(),
    warmZeroDteBoard(),
  ]);

  let ok = 0;
  for (const r of results) {
    if (r.status === "fulfilled") ok += 1;
  }
  const failed = results.length - ok;

  await logCronRun("platform-warm", started, {
    ok: failed < results.length,
    warmed: ok,
    failed,
    total: results.length,
    heatmap_tickers: heatmapTickers.length,
    dark_pool_tickers: darkPoolTickers.length,
    ...(failed > 0 ? { error: `${failed}/${results.length} platform warm task(s) failed` } : {}),
  });

  return NextResponse.json({
    ok: failed < results.length,
    warmed: ok,
    failed,
    total: results.length,
  });
}
