import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import {
  type PublicGexSnapshot,
  type PublicGexTicker,
  sanitizePublicRead,
} from "@/lib/public-gex-snapshot-types";

export type { PublicGexSnapshot, PublicGexTicker } from "@/lib/public-gex-snapshot-types";
export {
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

// This is a marketing lead-magnet, not the trading product — a several-minute-old
// read is an acceptable, honest tradeoff (the page says so) in exchange for bounding
// upstream Polygon calls to at most once per ticker per TTL, REGARDLESS of anonymous
// traffic volume. Same shared-Polygon-budget concern as gex-heatmap's OVERLAY_TTL_MS.
const CACHE_TTL_SEC = 300;
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
      read: sanitizePublicRead(heatmap.gex.regime.read),
    };
    await sharedCacheSet(cacheKey, snapshot, CACHE_TTL_SEC).catch(() => undefined);
    return snapshot;
  } catch (err) {
    console.warn("[public-gex-snapshot] build failed", ticker, err);
    return emptySnapshot(ticker);
  }
}
