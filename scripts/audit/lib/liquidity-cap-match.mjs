/**
 * Pure liquidity/market-cap matching helpers for the G-11 single-stock control
 * (g11-earnings-liquidity-control.mjs — INTENTIONAL-DESIGN.md §5's own stated next step: "a
 * liquidity/cap-matched single-stock control ... is the natural next step before any gate change
 * is even drafted").
 *
 * Kept dependency-free and pure (no fetch, no Date.now()) so the matching/aggregation logic is
 * unit-testable without hitting the network — every network-touching call (grouped-daily,
 * ticker-detail market cap, minute bars) lives in the orchestrating script itself, same split as
 * `lib/print-window-eval.mjs` vs `g11-print-window-outcome.mjs`.
 */

// Broad-market ETFs / index products a matcher could otherwise pick as a "single stock" control.
// Not exhaustive — the point is to catch the obvious, extremely liquid ones a dollar-volume-first
// ranking would otherwise surface near the top of every candidate pool.
const KNOWN_ETF_INDEX_DENYLIST = new Set([
  "SPY", "QQQ", "IWM", "DIA", "VOO", "VTI", "IVV", "VEA", "VWO", "EFA", "EEM", "MDY",
  "IJH", "IJR", "IWO", "IWN", "IWD", "IWF", "RSP",
  "XLK", "XLF", "XLE", "XLY", "XLP", "XLV", "XLI", "XLU", "XLB", "XLRE", "XLC",
  "SMH", "SOXX", "SOXL", "SOXS", "ARKK", "ARKW", "ARKG", "ARKF", "ARKQ",
  "TQQQ", "SQQQ", "UVXY", "SVXY", "VXX", "VIXY", "SPXL", "SPXS", "UPRO", "SPXU",
  "GLD", "SLV", "GDX", "GDXJ", "USO", "UNG", "UUP",
  "TLT", "IEF", "SHY", "TIP", "LQD", "HYG", "AGG", "BND", "JNK",
]);

export function isKnownEtfOrIndexProduct(ticker) {
  return KNOWN_ETF_INDEX_DENYLIST.has(String(ticker ?? "").toUpperCase());
}

/**
 * Cheap "looks like an ordinary single listed common stock" shape test, applied BEFORE any
 * per-ticker market-cap call is spent on a candidate. 1-5 pure uppercase letters excludes the
 * dotted/hyphenated preferred-share and unit/warrant/rights tickers Polygon's stock universe
 * otherwise mixes into grouped-daily (e.g. "BAC.PRB", "ABC.WS", "ABC.U", "ABC-A"). This is a
 * necessary-not-sufficient filter — the orchestrating script also checks the real `type` field
 * from the per-ticker detail call it already spends for market cap, requiring "CS" there.
 */
export function looksLikeOrdinaryTickerShape(ticker) {
  return /^[A-Z]{1,5}$/.test(String(ticker ?? ""));
}

/** Fold one grouped-daily response's rows into a running per-ticker liquidity accumulator. */
export function accumulateLiquidityDay(acc, dailyRows) {
  for (const row of dailyRows ?? []) {
    const ticker = String(row?.T ?? "").toUpperCase();
    const close = Number(row?.c);
    const volume = Number(row?.v);
    if (!ticker || !(close > 0) || !(volume >= 0)) continue;
    const entry = acc.get(ticker) ?? { sumDollarVol: 0, sumPrice: 0, days: 0 };
    entry.sumDollarVol += close * volume;
    entry.sumPrice += close;
    entry.days += 1;
    acc.set(ticker, entry);
  }
  return acc;
}

/** Turn the running accumulator into ticker -> {avgDollarVol, avgPrice, days}. */
export function finalizeLiquidityMap(acc) {
  const out = new Map();
  for (const [ticker, e] of acc.entries()) {
    if (!(e.days > 0)) continue;
    out.set(ticker, {
      avgDollarVol: e.sumDollarVol / e.days,
      avgPrice: e.sumPrice / e.days,
      days: e.days,
    });
  }
  return out;
}

/**
 * Build the candidate control pool from a finalized liquidity map: liquid, ordinary-shaped,
 * non-ETF, non-earnings-window names, ranked by average dollar volume (richest first) and capped
 * to `poolSize`. `excludeTickers` is expected to be every ticker that reported earnings anywhere
 * in the (buffered) exclusion window, at ANY importance/status — see the script header for why
 * that buffer exists.
 */
export function buildCandidatePool({
  liquidityMap,
  excludeTickers,
  minPrice,
  maxPrice,
  minDollarVol,
  minDays,
  poolSize,
}) {
  const excluded = excludeTickers instanceof Set ? excludeTickers : new Set(excludeTickers ?? []);
  const rows = [];
  for (const [ticker, stats] of liquidityMap.entries()) {
    if (excluded.has(ticker)) continue;
    if (isKnownEtfOrIndexProduct(ticker)) continue;
    if (!looksLikeOrdinaryTickerShape(ticker)) continue;
    if (!(stats.days >= minDays)) continue;
    if (!(stats.avgPrice >= minPrice && stats.avgPrice <= maxPrice)) continue;
    if (!(stats.avgDollarVol >= minDollarVol)) continue;
    rows.push({ ticker, avgDollarVol: stats.avgDollarVol, avgPrice: stats.avgPrice, days: stats.days });
  }
  rows.sort((a, b) => b.avgDollarVol - a.avgDollarVol);
  return rows.slice(0, poolSize);
}

/**
 * Combined log-space distance between a target {cap,dvol} and a candidate {cap,dvol}. Symmetric
 * and zero at equality, and grows with the RATIO rather than the absolute difference — market cap
 * and dollar volume both span several orders of magnitude across the market, so a mega-cap 2x off
 * and a small-cap 2x off must be penalized equally. Infinity (never selected) whenever either side
 * is missing or non-positive, so a data gap can never look like a perfect match.
 */
export function capDollarVolDistance(target, candidate) {
  if (!(target?.cap > 0) || !(target?.dvol > 0) || !(candidate?.cap > 0) || !(candidate?.dvol > 0)) {
    return Infinity;
  }
  return Math.abs(Math.log(target.cap / candidate.cap)) + Math.abs(Math.log(target.dvol / candidate.dvol));
}

/**
 * Nearest-neighbor match by combined cap+dollar-volume distance. `excludeTicker` guards against a
 * target ever matching itself if it somehow leaked into the candidate pool (it should not — the
 * pool is built to exclude every earnings-window reporter — but this keeps the matcher provably
 * self-safe rather than relying only on the caller's exclusion set being correct).
 */
export function nearestCandidateMatch(target, candidates, excludeTicker) {
  let best = null;
  let bestDist = Infinity;
  for (const c of candidates ?? []) {
    if (excludeTicker && c.ticker === excludeTicker) continue;
    const d = capDollarVolDistance(target, { cap: c.cap, dvol: c.dvol });
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  if (!best) return null;
  return { ...best, distance: bestDist };
}

export function median(nums) {
  const arr = (nums ?? []).filter((n) => Number.isFinite(n));
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
