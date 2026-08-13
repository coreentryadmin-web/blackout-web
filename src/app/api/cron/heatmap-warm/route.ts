// Cron: pre-warm the shared GEX heatmap matrix cache for the shared sticky universe
// (static allowlist ∪ dynamic ≤100 / 14d — same set Vector records beads for).
// Schedule: ~every 30-45s during market hours (registered in cron-registry.ts as
// "heatmap-warm"; EventBridge wires the actual fire).
//
// THE POINT: the Heat Maps UI / Largo explain / gex-positioning all read fetchGexHeatmap(ticker),
// which dedups per ticker through the in-memory + Redis matrix cache (and a single-flight guard).
// Without this cron, TTL expiry under burst causes a cold-build spike (N users racing N chain
// fetches before the cache fills). Warming the SHARED universe (static + member-viewed dynamic)
// keeps Thermal matrices cache-hot for the same names Vector already records. All upstream calls
// flow through the permissive Polygon rate-limiter; warm names are Redis-cache-first (near-free).
// Overlays (UW) are NOT warmed here — the matrix is the only thing that goes cold; overlays stay
// gated by the static allowlist (2 RPS UW budget).
//
// DELTA BROADCAST: after warming each ticker, calculate the delta vs. the previous snapshot
// and broadcast to all active SSE subscribers (/api/market/gex-matrix-deltas). This gives
// real-time perception (10-15s) while keeping the full rebuild to 30-45s cadence.

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { listSharedUniverseTickers } from "@/features/vector/lib/vector-dynamic-universe";
import { comparePresetWarmTickers } from "@/features/thermal/lib/thermal-compare-presets";
import { shouldRunCacheWarmer } from "@/lib/cache-warmer-gate";
import { calculateMatrixDelta, type GexMatrix } from "@/lib/gex-matrix-delta";
import { broadcastMatrixDelta } from "@/lib/gex-matrix-broadcast";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
    await logCronRun("heatmap-warm", started, payload);
    return NextResponse.json(payload);
  }

  // Shared with Vector bead recording: static allowlist ∪ dynamic (≤100, 14d retention).
  const tickers = await listSharedUniverseTickers();
  // Every Thermal compare-preset name — cache-first warm so opening Mag7/Semis paints instantly.
  const comparePresetTickers = comparePresetWarmTickers();
  // Core Thermal compare desk (SPY|SPX|QQQ) first + forceRefresh so asof advances every warm
  // tick even when the 5s TTL hasn't expired — EventBridge floors at 1/min; without force the
  // cache can serve a 5–90s-stale matrix while members watch "MATRIX · 45s". Rest of the
  // shared universe warms after (cache-first; dynamic names already viewed are near-free).
  const CORE = ["SPY", "SPX", "QQQ"] as const;
  const coreSet = new Set<string>(CORE);
  const prioritySet = new Set<string>([...CORE, ...comparePresetTickers]);
  const priority = [...prioritySet].filter((t) => tickers.includes(t));
  const core = CORE.filter((t) => tickers.includes(t));
  const rest = tickers.filter((t) => !prioritySet.has(t));

  const priorityResults: PromiseSettledResult<Awaited<ReturnType<typeof fetchGexHeatmap>>>[] = [];
  for (const t of priority.filter((t) => !coreSet.has(t))) {
    try {
      const data = await fetchGexHeatmap(t);
      priorityResults.push({ status: "fulfilled", value: data });
    } catch (reason) {
      priorityResults.push({ status: "rejected", reason });
    }
  }

  const coreResults: PromiseSettledResult<Awaited<ReturnType<typeof fetchGexHeatmap>>>[] = [];
  for (const t of core) {
    try {
      const data = await fetchGexHeatmap(t, { forceRefresh: true });
      coreResults.push({ status: "fulfilled", value: data });
    } catch (reason) {
      coreResults.push({ status: "rejected", reason });
    }
  }
  const restResults = await Promise.allSettled(rest.map((t) => fetchGexHeatmap(t)));
  const orderedTickers = [
    ...priority.filter((t) => !coreSet.has(t)),
    ...core,
    ...rest,
  ];
  const results = [...priorityResults, ...coreResults, ...restResults];

  let warmed = 0;
  let deltasBroadcast = 0;
  const broadcastErrors: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status !== "fulfilled") continue;

    warmed += 1;

    const ticker = orderedTickers[i];
    const gexHeatmap = r.value;

    // Skip delta calculation if current snapshot is unavailable
    if (!gexHeatmap) continue;

    try {
      // Adapt GexHeatmap to GexMatrix format for delta calculation
      // (extract just the fields needed: underlying, spot, strikes, expiries, gex cells, asof)
      const currentSnapshot: GexMatrix = {
        underlying: gexHeatmap.underlying,
        spot: gexHeatmap.spot,
        strikes: gexHeatmap.strikes,
        expiries: gexHeatmap.expiries,
        gex: gexHeatmap.gex.cells,
        asof: gexHeatmap.asof,
      };

      // Get previous snapshot from cache
      const cacheKey = `gex-matrix-snapshot:${ticker}`;
      let previousSnapshot: GexMatrix | null = null;
      try {
        previousSnapshot = await sharedCacheGet<GexMatrix>(cacheKey);
      } catch {
        // Redis optional; continue without previous snapshot
      }

      // Calculate delta vs. previous snapshot
      const delta = calculateMatrixDelta(previousSnapshot, currentSnapshot);
      if (delta) {
        // Broadcast delta to all SSE subscribers
        await broadcastMatrixDelta(delta);
        deltasBroadcast += 1;
      }

      // Store current snapshot for next delta calculation
      try {
        const snapshotTtlSec = 120; // 2 minutes; cron fires ~every 30-45s
        await sharedCacheSet(cacheKey, currentSnapshot, snapshotTtlSec).catch(() => {
          // Redis optional; log but continue
          console.warn(`[cron/heatmap-warm] Failed to cache snapshot for ${ticker}`);
        });
      } catch {
        /* ignored */
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[cron/heatmap-warm] Delta broadcast failed for ${ticker}: ${msg}`);
      broadcastErrors.push(`${ticker}: ${msg}`);
    }
  }

  const failed = results.length - warmed;
  if (failed > 0) {
    console.warn(`[cron/heatmap-warm] ${failed} universe warm(s) failed`);
  }

  // ok:false (=> failed status + critical alert) only when the WHOLE batch fails; a partial
  // failure logs ok with the count so one flaky underlying doesn't page ops.
  const allFailed = tickers.length > 0 && failed === tickers.length;
  await logCronRun("heatmap-warm", started, {
    ok: !allFailed,
    warmed,
    failed,
    deltasBroadcast,
    total: tickers.length,
    core: core.length,
    rest: rest.length,
    ...(failed > 0 ? { error: `${failed}/${tickers.length} universe warm(s) failed` } : {}),
    ...(broadcastErrors.length > 0 ? { broadcastErrors } : {}),
  });

  return NextResponse.json({
    ok: true,
    warmed,
    total: tickers.length,
    core: core.length,
    rest: rest.length,
    deltasBroadcast,
  });
}
