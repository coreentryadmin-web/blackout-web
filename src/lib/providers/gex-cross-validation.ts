import "server-only";

/**
 * GEX cross-validation via UW per-strike dealer gamma.
 *
 * Prefers the UW `gex_strike_expiry:TICKER` WebSocket ladder when the channel is
 * fresh (zero REST RPS). Falls back to `/api/stock/{ticker}/spot-exposures/strike`
 * cached for 60s when WS data is unavailable.
 *
 * Usage: call `validateGexAgainstUW(ticker, primaryGexWalls)` after getGexPositioning()
 * returns — it does NOT block the primary data path and only logs divergences.
 */

import { fetchUwSpotExposuresByStrike } from "@/lib/providers/unusual-whales";
import { getGexStrikeExpiryLadder, isUwChannelFresh } from "@/lib/ws/uw-socket";

// ---------------------------------------------------------------------------
// In-process 60-second cache (avoids hammering the UW 2 RPS budget).
// One entry per ticker — in practice only "SPX" is used.
// ---------------------------------------------------------------------------
type CacheEntry = {
  strikeLadder: Map<number, number>; // strike → net_gex
  cachedAt: number;
};

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

/** Top-N strikes by |net_gex| magnitude from the ladder. */
function topNStrikes(ladder: Map<number, number>, n: number): number[] {
  return Array.from(ladder.entries())
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, n)
    .map(([strike]) => strike);
}

/**
 * Build (or return cached) per-strike GEX map from UW WS (preferred) or REST fallback.
 * Each entry: strike → net_gex (call_gamma_oi + put_gamma_oi in the UW normalized shape).
 */
async function getUwStrikeLadder(ticker: string): Promise<Map<number, number> | null> {
  const key = ticker.toUpperCase();
  const entry = cache.get(key);
  if (entry && Date.now() - entry.cachedAt < CACHE_TTL_MS) {
    return entry.strikeLadder;
  }

  if (isUwChannelFresh("gex_strike_expiry", 120_000)) {
    const ws = getGexStrikeExpiryLadder(key);
    if (ws && ws.ladder.size > 0) {
      cache.set(key, { strikeLadder: ws.ladder, cachedAt: ws.updatedAt });
      return ws.ladder;
    }
  }

  let rows: Record<string, unknown>[];
  try {
    rows = await fetchUwSpotExposuresByStrike(key, 500);
  } catch {
    return null; // UW unavailable — cross-validation is best-effort only
  }

  if (!rows || rows.length === 0) return null;

  const ladder = new Map<number, number>();
  for (const r of rows) {
    const strike = Number(r.strike ?? r.strike_price);
    if (!Number.isFinite(strike) || strike <= 0) continue;
    const callG = Number(r.call_gamma_oi ?? r.call_gex ?? r.call_gamma ?? 0);
    const putG = Number(r.put_gamma_oi ?? r.put_gex ?? r.put_gamma ?? 0);
    const net = (Number.isFinite(callG) ? callG : 0) + (Number.isFinite(putG) ? putG : 0);
    ladder.set(strike, net);
  }

  if (ladder.size === 0) return null;

  cache.set(key, { strikeLadder: ladder, cachedAt: Date.now() });
  return ladder;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type GexCrossValidationResult = {
  /** True when the primary call wall is within ±2 strikes of the UW top-GEX strike. */
  callWallMatch: boolean;
  /** True when the primary put wall is within ±2 strikes of the UW top-GEX strike. */
  putWallMatch: boolean;
  /** True when the primary gamma flip is within ±2 strikes of the UW top-GEX strike. */
  flipMatch: boolean;
  /**
   * Max point-distance between a primary key level and the nearest UW strike.
   * Null when UW data is unavailable or all primary levels are null.
   */
  divergence: number | null;
  /** ISO timestamp of when the UW ladder was fetched (cached). */
  uw_asof: string | null;
};

/**
 * Cross-validate primary GEX walls against the UW per-strike dealer gamma ladder.
 * WS-first when `gex_strike_expiry` is fresh; REST cached 60s otherwise.
 * Returns null when UW data is not available (never blocks the primary path).
 */
export async function validateGexAgainstUW(
  ticker: string,
  primary: { callWall: number | null; putWall: number | null; gammaFlip: number | null }
): Promise<GexCrossValidationResult | null> {
  const ladder = await getUwStrikeLadder(ticker).catch(() => null);
  if (!ladder || ladder.size === 0) return null;

  // Top-10 UW strikes by |net_gex| magnitude — the key-level candidates.
  const topStrikes = topNStrikes(ladder, 10);
  if (topStrikes.length === 0) return null;

  const STRIKE_TOLERANCE = 2; // ±2 strikes (each strike is typically 5pt for SPX)

  function isMatch(level: number | null): { match: boolean; minDist: number | null } {
    if (level == null || !Number.isFinite(level)) return { match: false, minDist: null };
    const minDist = Math.min(...topStrikes.map((s) => Math.abs(s - level)));
    return { match: minDist <= STRIKE_TOLERANCE, minDist };
  }

  const callResult = isMatch(primary.callWall);
  const putResult = isMatch(primary.putWall);
  const flipResult = isMatch(primary.gammaFlip);

  // Max divergence across all available primary levels.
  const dists = [callResult.minDist, putResult.minDist, flipResult.minDist].filter(
    (d): d is number => d != null
  );
  const divergence = dists.length > 0 ? Math.max(...dists) : null;

  const entry = cache.get(ticker.toUpperCase());
  const uw_asof = entry ? new Date(entry.cachedAt).toISOString() : null;

  return {
    callWallMatch: callResult.match,
    putWallMatch: putResult.match,
    flipMatch: flipResult.match,
    divergence,
    uw_asof,
  };
}
