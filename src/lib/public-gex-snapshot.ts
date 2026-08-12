import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import {
  classifyWall,
  correctPublicRead,
  type PublicGexSnapshot,
  type PublicGexTicker,
  sanitizePublicRead,
} from "@/lib/public-gex-snapshot-types";

export type { PublicGexSnapshot, PublicGexTicker, PublicWallRole } from "@/lib/public-gex-snapshot-types";
export {
  classifyWall,
  correctPublicRead,
  isPublicGexTicker,
  publicGexTickers,
  sanitizePublicRead,
} from "@/lib/public-gex-snapshot-types";

/**
 * Sanitized, PUBLIC projection of the GEX heatmap — the free lead-magnet snapshot
 * at /tools/gamma-snapshot (docs/marketing/SEO-GROWTH.md finding #5). Deliberately
 * thin: spot, call/put wall, gamma flip, and the regime read only — no strike/expiry
 * matrix, no flow/dark-pool overlays, nothing that would substitute for the real
 * (live, tick-by-tick) product members pay for.
 */

// 5s — matched to the lane underneath, NOT a loosened budget.
//
// This was 300s, justified as "bounding upstream Polygon calls to at most once per ticker per TTL,
// REGARDLESS of anonymous traffic volume". That bound is real but it is ALREADY provided one layer
// down: fetchGexHeatmap is itself cached at GEX_HEATMAP_CACHE_SEC (default 5s) and warmed by the
// heatmap-warm cron, which is exactly the lane Thermal reads. This wrapper was therefore redundant
// protection over an already-protected call, and dropping it to 5s adds ZERO upstream vendor
// requests — an anonymous miss now costs a Redis read instead of being absorbed here.
//
// 5s is the floor worth having: the source only changes every 5s, so a shorter TTL would spend
// work to re-serve identical bytes.
const CACHE_TTL_SEC = 5;
const EMPTY_CACHE_TTL_SEC = 30; // short-lived so a transient upstream miss self-heals fast

function emptySnapshot(ticker: string): PublicGexSnapshot {
  return {
    available: false,
    ticker,
    spot: null,
    change_pct: null,
    asof: null,
    call_wall: null,
    put_wall: null,
    flip: null,
    posture: null,
    call_wall_role: null,
    put_wall_role: null,
    read: "Snapshot warming up — check back shortly.",
  };
}

export async function buildPublicGexSnapshot(ticker: PublicGexTicker): Promise<PublicGexSnapshot> {
  const cacheKey = `public-gex-snapshot:${ticker}`;
  try {
    const cached = await sharedCacheGet<PublicGexSnapshot>(cacheKey);
    if (cached) return cached;
  } catch {
    /* fall through to a fresh compute */
  }

  try {
    const heatmap = await fetchGexHeatmap(ticker);
    if (!heatmap) {
      const empty = emptySnapshot(ticker);
      await sharedCacheSet(cacheKey, empty, EMPTY_CACHE_TTL_SEC).catch(() => undefined);
      return empty;
    }
    const snapshot: PublicGexSnapshot = {
      available: true,
      ticker,
      spot: heatmap.spot,
      change_pct: heatmap.change_pct,
      asof: heatmap.asof,
      call_wall: heatmap.gex.call_wall,
      put_wall: heatmap.gex.put_wall,
      flip: heatmap.gex.flip,
      posture: heatmap.gex.regime.posture,
      call_wall_role: classifyWall("call", heatmap.gex.call_wall, heatmap.spot),
      put_wall_role: classifyWall("put", heatmap.gex.put_wall, heatmap.spot),
      // Sanitize (drop vendor provenance) THEN correct (drop wrong-side level claims).
      read: correctPublicRead(sanitizePublicRead(heatmap.gex.regime.read), {
        spot: heatmap.spot,
        call_wall: heatmap.gex.call_wall,
        put_wall: heatmap.gex.put_wall,
      }),
    };
    await sharedCacheSet(cacheKey, snapshot, CACHE_TTL_SEC).catch(() => undefined);
    return snapshot;
  } catch (err) {
    console.warn("[public-gex-snapshot] build failed", ticker, err);
    return emptySnapshot(ticker);
  }
}
