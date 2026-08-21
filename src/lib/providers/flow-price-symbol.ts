/**
 * Which Polygon aggregates symbol prices a FLOW-TAPE ticker, and which namespace it lives in.
 *
 * UW's option tape carries the OPTION ROOT as its `ticker`. For an equity that root is also the
 * equity symbol, so `/v2/aggs/ticker/AAPL/...` prices it. For an INDEX product it is not: SPX, NDX,
 * RUT and friends have no listing in Polygon's equity namespace — they price under `I:`.
 *
 * The failure mode this exists to stop is that the equity namespace does not ERROR for them. Probed
 * live on 2026-08-19:
 *
 *   /v2/aggs/ticker/SPX/...    -> HTTP 200  status OK  resultsCount 0   (no results array)
 *   /v2/aggs/ticker/I:SPX/...  -> HTTP 200  status OK  5 bars
 *   /v2/aggs/ticker/AAPL/...   -> HTTP 200  status OK  5 bars
 *
 * A silent empty success. Nothing throws, nothing logs, the caller just gets `[]` and concludes the
 * price is unknown — forever, on every retry.
 *
 * WEEKLY ROOTS MAP TO THEIR BASE INDEX, NOT TO `I:` + THEMSELVES. `I:SPXW`, `I:NDXP`, `I:RUTW` and
 * `I:VIXW` all return zero bars — the weekly root is an option series, not a separate index. Every
 * entry below was verified against live Polygon data rather than assumed from the naming pattern.
 *
 * WHY NOT REUSE `vectorPolygonMinuteSymbol`: it is correct for its own surface but wrong here.
 * It routes through `normalizeVectorTicker`, which FALLS BACK TO "SPX" on any input failing its
 * charset test. For a user-facing chart that is a sensible default; for outcome grading it would
 * silently price some other instrument's signal against SPX. An unknown symbol must fall through to
 * the equity path and be allowed to return nothing — a missing price is recoverable, a confidently
 * wrong one is not.
 */

/** Flow-tape root → Polygon index symbol. Every value verified to return live bars. */
const INDEX_PRICE_SYMBOL: Readonly<Record<string, string>> = Object.freeze({
  SPX: "I:SPX",
  SPXW: "I:SPX", // weekly SPX series — prices off the SPX index itself
  NDX: "I:NDX",
  NDXP: "I:NDX",
  RUT: "I:RUT",
  RUTW: "I:RUT",
  VIX: "I:VIX",
  VIXW: "I:VIX",
  XSP: "I:XSP",
  DJX: "I:DJX",
  DJI: "I:DJI",
  XND: "I:XND",
  OEX: "I:OEX",
  MXEA: "I:MXEA",
});

export type FlowPriceSymbol = {
  /** The symbol to pass to the aggregates endpoint. */
  symbol: string;
  /** True → use the index aggregates path; false → the equity one. */
  isIndex: boolean;
};

/**
 * Resolve a flow-tape ticker to the symbol that actually prices it.
 *
 * Unknown symbols pass through UNCHANGED on the equity path. That is deliberate: this map only
 * claims to know index roots, and a symbol it does not recognise is far more likely to be an
 * ordinary equity than an unlisted index. Guessing an `I:` form for it would turn a working equity
 * lookup into a silent empty one.
 */
export function flowPriceSymbol(ticker: string | null | undefined): FlowPriceSymbol | null {
  const raw = String(ticker ?? "").trim().toUpperCase();
  if (!raw) return null;
  // A caller that already holds the Polygon index form should get it back untouched.
  if (raw.startsWith("I:")) return { symbol: raw, isIndex: true };
  const mapped = INDEX_PRICE_SYMBOL[raw];
  return mapped ? { symbol: mapped, isIndex: true } : { symbol: raw, isIndex: false };
}

/** True when this flow-tape ticker is an index product rather than an equity. */
export function isIndexFlowTicker(ticker: string | null | undefined): boolean {
  return flowPriceSymbol(ticker)?.isIndex === true;
}

/** The roots this module claims to know — exported so tests can assert coverage. */
export const KNOWN_INDEX_FLOW_ROOTS: readonly string[] = Object.freeze(Object.keys(INDEX_PRICE_SYMBOL));
