import "server-only";

/**
 * GEX cross-validation via UW per-strike dealer gamma.
 *
 * Prefers the UW `gex_strike_expiry:TICKER` WebSocket ladder when the channel is
 * fresh (zero REST RPS). Falls back to `/api/stock/{ticker}/spot-exposures/strike`
 * cached for 60s when WS data is unavailable.
 *
 * Usage: call `validateGexAgainstUW(ticker, primaryGexWalls, { nearTermExpiries })`
 * after getGexPositioning() returns — it does NOT block the primary data path and
 * only logs divergences.
 *
 * Matching is sign-aware: call wall ↔ max positive UW net GEX, put wall ↔ max negative,
 * flip ↔ zero-crossing on the UW ladder (same semantics as Polygon computeGexRegime).
 *
 * SCOPE: `primary` is computed by the caller from Polygon's near-term-only walls
 * (polygon-options-gex.ts deliberately excludes far-dated monthly/quarterly OI —
 * it would otherwise swamp the actionable near-term walls). The WS ladder here
 * stores every expiry ever received, so passing `opts.nearTermExpiries` (the SAME
 * near-term expiry set the caller used) is required for an apples-to-apples
 * comparison — without it, this ladder sums in far-dated OpEx OI that Polygon's
 * side never includes, producing hundreds of points of spurious divergence for
 * SPX (confirmed live 2026-07-01).
 *
 * REST fallback: verified live (2026-07-01) that it CANNOT be scoped the same way, so when
 * scoping is required it is skipped entirely rather than run unscoped:
 *  - `/spot-exposures/strike` (used below) returns ONE row per strike already summed across
 *    EVERY expiry server-side — there is no per-expiry field to filter on after the fact.
 *  - `/spot-exposures/expiry-strike` (used elsewhere in unusual-whales.ts for 0DTE) DOES carry a
 *    per-row `expiry` field, but its `expirations[]` filter only honors ONE value even when
 *    several are passed (verified: passing 3 values returned only the last one's rows), and
 *    without a filter it caps at 50 rows that don't reliably cover the needed strike band
 *    (verified: 50 unfiltered rows for the 0DTE expiry covered strikes 7620-9800 only — the
 *    entire near-the-money/put-wall region below spot was missing). Neither endpoint can
 *    produce a properly-scoped ladder without N sequential per-expiry calls against a
 *    documented-flaky, rate-limited API, for a path that's supposed to be a rare, cheap
 *    fallback. A guaranteed-mismatched comparison is worse than no comparison — it would
 *    reintroduce the exact scope-mismatch false-positive this module exists to prevent, just
 *    intermittently (whenever the WS channel goes stale) instead of always.
 */

import { fetchUwSpotExposuresByStrike } from "@/lib/providers/unusual-whales";
import {
  crossValidateGexLevels,
  restFallbackAllowed,
  type GexCrossValidationCoreResult,
} from "@/lib/providers/gex-cross-validation-core";
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

/** A scoped and an unscoped call for the same ticker must never share a cache entry. */
function ladderCacheKey(ticker: string, nearTermExpiries?: readonly string[]): string {
  const key = ticker.toUpperCase();
  return nearTermExpiries && nearTermExpiries.length > 0 ? `${key}:${nearTermExpiries.join(",")}` : key;
}

/**
 * Build (or return cached) per-strike GEX map from UW WS (preferred) or REST fallback.
 * Each entry: strike → net_gex (call_gamma_oi + put_gamma_oi in the UW normalized shape).
 *
 * `nearTermExpiries`, when given, scopes the WS ladder to only those expiries so it
 * matches the same scope as the Polygon-side `primary` walls being validated (see
 * the module-level SCOPE doc above). Included in the cache key so a scoped and an
 * unscoped call for the same ticker never collide.
 */
async function getUwStrikeLadder(
  ticker: string,
  nearTermExpiries?: readonly string[]
): Promise<Map<number, number> | null> {
  const key = ticker.toUpperCase();
  const cacheKey = ladderCacheKey(ticker, nearTermExpiries);
  const entry = cache.get(cacheKey);
  if (entry && Date.now() - entry.cachedAt < CACHE_TTL_MS) {
    return entry.strikeLadder;
  }

  if (isUwChannelFresh("gex_strike_expiry", 120_000)) {
    const ws = getGexStrikeExpiryLadder(key, nearTermExpiries);
    if (ws && ws.ladder.size > 0) {
      cache.set(cacheKey, { strikeLadder: ws.ladder, cachedAt: ws.updatedAt });
      return ws.ladder;
    }
  }

  if (!restFallbackAllowed(nearTermExpiries)) {
    return null;
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

  cache.set(cacheKey, { strikeLadder: ladder, cachedAt: Date.now() });
  return ladder;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type GexCrossValidationResult = Omit<GexCrossValidationCoreResult, "uw"> & {
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
  primary: { callWall: number | null; putWall: number | null; gammaFlip: number | null },
  opts?: { spot?: number; nearTermExpiries?: readonly string[] }
): Promise<GexCrossValidationResult | null> {
  const ladder = await getUwStrikeLadder(ticker, opts?.nearTermExpiries).catch(() => null);
  if (!ladder || ladder.size === 0) return null;

  const core = crossValidateGexLevels(primary, ladder, { spot: opts?.spot });
  if (!core) return null;

  const entry = cache.get(ladderCacheKey(ticker, opts?.nearTermExpiries));
  const uw_asof = entry ? new Date(entry.cachedAt).toISOString() : null;

  const { uw: _uw, ...rest } = core;
  return { ...rest, uw_asof };
}
