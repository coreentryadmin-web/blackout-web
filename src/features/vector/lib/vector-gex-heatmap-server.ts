import "server-only";

import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { normalizeVectorTicker } from "./vector-ticker";
import { loadCurrentChainContracts, loadSessionSpotSamples } from "./vector-gex-reconstruct-server";
import { reconstructGexHeatmapGrid, type GexHeatmapGrid } from "./vector-gex-reconstruct";
import { normalizeHeatmapBucketSec } from "./vector-gex-heatmap-paint";
import { expiriesForHorizon, type VectorDteHorizon } from "./vector-dte-horizon";

const LIVE_HEATMAP_CACHE_PREFIX = "vector:live-gex-heatmap";
/** Short TTL — grid is cheap to rebuild but bars/spot path moves every minute during RTH. */
const LIVE_HEATMAP_TTL_SEC = 90;

export { normalizeHeatmapBucketSec } from "./vector-gex-heatmap-paint";

function liveHeatmapCacheKey(
  ticker: string,
  horizon: VectorDteHorizon,
  sessionYmd: string,
  bucketSec: number
): string {
  return `${LIVE_HEATMAP_CACHE_PREFIX}:${ticker}:${horizon}:${sessionYmd}:${bucketSec}`;
}

/**
 * Horizon-scoped strike×time GEX positioning surface for the Vector chart heatmap.
 * OI reconstruction along the session spot path; the **last column** optionally includes
 * today's volume (point-in-time honest — not back-projected across history).
 */
export async function getVectorGexHeatmap(
  ticker: string,
  horizon: VectorDteHorizon,
  sessionYmd: string,
  bucketSec = 300
): Promise<GexHeatmapGrid | null> {
  const t = normalizeVectorTicker(ticker);
  const bucket = normalizeHeatmapBucketSec(bucketSec);
  try {
    const cacheKey = liveHeatmapCacheKey(t, horizon, sessionYmd, bucket);
    const hit = await sharedCacheGet<GexHeatmapGrid>(cacheKey).catch(() => null);
    if (hit?.times?.length) return hit;

    const pos = await getGexPositioning(t);
    const spot = pos?.spot;
    if (!(spot && spot > 0)) return null;

    const contracts = await loadCurrentChainContracts(t, spot);
    if (!contracts.length) return null;

    const today = todayEtYmd();
    const expiries = [...new Set(contracts.map((c) => c.expiry))].sort();
    const scoped = new Set(expiriesForHorizon(expiries, horizon, today));
    if (scoped.size === 0) return null;
    const filtered = contracts.filter((c) => scoped.has(c.expiry));
    if (!filtered.length) return null;

    const spots = await loadSessionSpotSamples(t, sessionYmd, bucket);
    if (!spots.length) return null;

    const grid = reconstructGexHeatmapGrid(filtered, spots, today, {
      maxStrikes: 80,
      volumeAdjustLastColumn: true,
      bucketSec: bucket,
    });
    if (!grid.times.length) return null;

    await sharedCacheSet(cacheKey, grid, LIVE_HEATMAP_TTL_SEC).catch(() => {});
    return grid;
  } catch {
    return null;
  }
}
