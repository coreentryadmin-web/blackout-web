import type { VectorDteHorizon } from "./vector-dte-horizon";
import { VECTOR_DEFAULT_NODE_DENSITY, type VectorNodeDensity } from "./vector-node-density";
import { VECTOR_DEFAULT_TIMEFRAME, type VectorPresetTimeframe } from "./vector-bar-timeframes";

/** Default Vector chart symbol — SPX index options desk anchor. */
export const VECTOR_DEFAULT_TICKER = "SPX";

/** Index keys that use Polygon `I:` minute bars and SPX-style oracle WS when subscribed. */
export const VECTOR_INDEX_TICKERS = new Set(["SPX", "NDX", "RUT", "DJI", "VIX"]);

/** Tickers with UW `gex_strike_expiry` WS oracle (see UW_WS_GEX_STRIKE_EXPIRY_TICKERS). */
export const VECTOR_ORACLE_TICKERS = new Set(["SPX", "SPY", "QQQ"]);

const TICKER_RE = /^[A-Z0-9.\-]{1,8}$/;

/** Normalize and validate a user-facing Vector ticker key. Falls back to SPX on junk input.
 *  Accepts Polygon-style index keys ("I:SPX" → "SPX") so deep links survive. */
export function normalizeVectorTicker(raw: string | null | undefined): string {
  let t = String(raw ?? VECTOR_DEFAULT_TICKER).trim().toUpperCase();
  if (t.startsWith("I:")) t = t.slice(2);
  if (!TICKER_RE.test(t)) return VECTOR_DEFAULT_TICKER;
  return t;
}

/**
 * True when a raw symbol is a well-formed ticker Vector will serve on demand.
 *
 * Vector is deliberately NOT restricted to the preset universe — any optionable
 * symbol works (the GEX/bars providers return honest-empty structure for
 * non-optionable ones, and the chart states that rather than erroring). The
 * preset list is only the quick-pick set and the server-recorded-rail set; it is
 * not an allowlist. This gate exists purely to reject junk/injection before the
 * value reaches the providers — a syntactically valid symbol (post-index-prefix
 * strip, matching TICKER_RE) is accepted; anything else (empty, spaces, control
 * chars, over length) is refused with a clean 400 instead of silently serving SPX.
 */
export function isVectorTickerAllowed(raw: string | null | undefined): boolean {
  let t = String(raw ?? "").trim().toUpperCase();
  if (t.startsWith("I:")) t = t.slice(2);
  return TICKER_RE.test(t);
}

export function isVectorIndexTicker(ticker: string): boolean {
  // normalizeVectorTicker strips any "I:" prefix, so the set lookup is total.
  return VECTOR_INDEX_TICKERS.has(normalizeVectorTicker(ticker));
}

/** Polygon aggregates symbol for minute-bar seed + live refresh. */
export function vectorPolygonMinuteSymbol(ticker: string): string {
  const t = normalizeVectorTicker(ticker);
  // Every VECTOR_INDEX_TICKERS member maps to its Polygon I: key — DJI was
  // missing, so ?ticker=DJI burned the 12-day walk-back with a bare "DJI"
  // symbol Polygon's index endpoint doesn't recognize and seeded nothing.
  if (VECTOR_INDEX_TICKERS.has(t)) return `I:${t}`;
  return t;
}

/**
 * True when UW WS gex_strike_expiry ladder is expected for this ticker.
 * @deprecated Use `hasLiveGexStrikeExpiry` from uw-socket.ts — dynamic subscription
 * means ANY ticker can have a live WS oracle, not just the static set.
 */
export function vectorHasWsOracle(ticker: string): boolean {
  return VECTOR_ORACLE_TICKERS.has(normalizeVectorTicker(ticker));
}

/** Opening DTE horizon: intraday desk defaults to 0DTE for every symbol (matrix + beads match session view). */
export function defaultVectorDteHorizon(_raw: string | null | undefined): VectorDteHorizon {
  return "0dte";
}

/**
 * Opening NODES density — single names open at 20 rows/side so their beads match SPX Slayer
 * showcase density (server records up to 20/side for all tickers; AUTO was self-limiting NVDA to
 * ~7). Index tickers (SPX et al.) must open on `"auto"` instead of this fixed count: VectorChart's
 * NODES-hydration effect only loads the member's saved density pick — or lets the timeframe-driven
 * AUTO ladder (`wallCountForTimeframe`, 8/11/13/16) apply at all — when the desk-open default is
 * exactly the `"auto"` sentinel (`if (defaultNodeDensity !== VECTOR_DEFAULT_NODE_DENSITY) return;`).
 * A fixed 20 for every ticker silently disabled that hydration for SPX too, so the SPX desk opened
 * permanently at 20 rows regardless of timeframe instead of the pinned Sep-3-reference ladder —
 * thinning the thick merged bead ribbons into visibly separate dotted circles (member-reported
 * 2026-09-07). Restoring `"auto"` for index tickers only keeps the deliberate single-name fix
 * intact while letting the index ladder (and any member NODES preference) resolve again.
 */
export const VECTOR_ORACLE_DEFAULT_NODE_DENSITY = 20 as const satisfies VectorNodeDensity;
export const VECTOR_DEFAULT_OPEN_NODE_DENSITY = VECTOR_ORACLE_DEFAULT_NODE_DENSITY;

export function defaultVectorNodeDensity(raw: string | null | undefined): VectorNodeDensity {
  if (isVectorIndexTicker(normalizeVectorTicker(raw))) return VECTOR_DEFAULT_NODE_DENSITY;
  return VECTOR_DEFAULT_OPEN_NODE_DENSITY;
}

/** Opening desk props shared by SPX Slayer embed and standalone /vector — one showcase contract. */
export type VectorDeskOpenDefaults = {
  defaultDteHorizon: VectorDteHorizon;
  defaultChartViewport: "session" | "live";
  defaultTimeframe: VectorPresetTimeframe;
  defaultNodeDensity: VectorNodeDensity;
};

/** Desk open: full-session bead rails · 3m · 0DTE · 20-row beads for every symbol. */
export function defaultVectorDeskOpenProps(
  raw: string | null | undefined
): VectorDeskOpenDefaults {
  return {
    defaultDteHorizon: defaultVectorDteHorizon(raw),
    defaultChartViewport: "session",
    defaultTimeframe: VECTOR_DEFAULT_TIMEFRAME,
    defaultNodeDensity: defaultVectorNodeDensity(raw),
  };
}
