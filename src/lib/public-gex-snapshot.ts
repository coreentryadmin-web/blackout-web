import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";

/**
 * Sanitized, PUBLIC projection of the GEX heatmap — the free lead-magnet snapshot
 * at /tools/gamma-snapshot (docs/marketing/SEO-GROWTH.md finding #5). Deliberately
 * thin: spot, call/put wall, gamma flip, and the regime read only — no strike/expiry
 * matrix, no flow/dark-pool overlays, nothing that would substitute for the real
 * (live, tick-by-tick) product members pay for.
 */
export type PublicGexSnapshot = {
  available: boolean;
  ticker: string;
  spot: number | null;
  change_pct: number | null;
  asof: string | null;
  call_wall: number | null;
  put_wall: number | null;
  flip: number | null;
  posture: "long" | "short" | null;
  read: string;
};

const ALLOWED_TICKERS = ["SPX", "SPY", "QQQ"] as const;
export type PublicGexTicker = (typeof ALLOWED_TICKERS)[number];

export function isPublicGexTicker(value: string): value is PublicGexTicker {
  return (ALLOWED_TICKERS as readonly string[]).includes(value);
}

export function publicGexTickers(): readonly PublicGexTicker[] {
  return ALLOWED_TICKERS;
}

// This is a marketing lead-magnet, not the trading product — a several-minute-old
// read is an acceptable, honest tradeoff (the page says so) in exchange for bounding
// upstream Polygon calls to at most once per ticker per TTL, REGARDLESS of anonymous
// traffic volume. Same shared-Polygon-budget concern as gex-heatmap's OVERLAY_TTL_MS.
const CACHE_TTL_SEC = 300;
const EMPTY_CACHE_TTL_SEC = 30; // short-lived so a transient upstream miss self-heals fast

/**
 * Strip vendor/infra provenance from the regime narration before it leaves the server.
 *
 * `read` is the ONLY unbounded string in this projection — every other field is a number or a
 * two-value enum. Its normal producer is harmless (it restates spot/flip/walls, all of which are
 * already in the payload), but the UW-FALLBACK producer appends
 * "(UW all-expiry dealer gamma — Polygon chain unavailable; levels are live UW OI, not the
 * canonical near-term Polygon matrix.)" — see polygon-options-gex.ts. On an authenticated desk
 * that is useful honesty; on an UNAUTHENTICATED endpoint it tells anyone who polls which market-
 * data vendors we buy and broadcasts, in real time, whenever our primary chain provider is
 * degraded. Neither belongs in a marketing lead magnet.
 *
 * Drops any parenthetical naming a data provider and leaves the trader-facing sentence intact, so
 * a future producer that adds a new provenance note is stripped too rather than silently leaking.
 */
export function sanitizePublicRead(read: string): string {
  return read
    .replace(/\s*\([^()]*\b(?:UW|Unusual\s*Whales|Polygon|Massive)\b[^()]*\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

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
