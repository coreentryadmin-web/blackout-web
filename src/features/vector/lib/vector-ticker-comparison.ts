import type { VectorUniverseRow } from "./vector-universe";
import { normalizeVectorTicker } from "./vector-ticker";
import {
  screenerRegimeOf,
  flipDistancePct,
  wallStrength,
  type ScreenerRegime,
} from "./vector-screener";

/**
 * Cross-ticker wall-structure comparison (P2 from the 2026-08-05 CTO audit) —
 * "a small multi-ticker mini-ladder strip — SPY vs sector ETF vs top 2-3
 * constituents — for relative-positioning reads". This module owns the
 * (deliberately static) peer-selection heuristic; the component just renders
 * whatever rows it resolves. No new data or math: comparisons are read
 * straight off the same VectorUniverseRow the scanner already loads, and the
 * per-row metrics reuse `screenerRegimeOf`/`flipDistancePct`/`wallStrength`
 * verbatim.
 *
 * The peer map is a reasonable static default, not an attempt at a "correct"
 * sector taxonomy — it only needs to answer "what's a sensible thing to put
 * next to this ticker", and every entry doubles as a name Vector already
 * warms (see `HEATMAP_PRESET_TICKERS`/`HEATMAP_EXTRA_LIQUID_TICKERS` in
 * `src/lib/heatmap-allowlist.ts`) so it usually resolves a row.
 */

/** Broad index proxies — compared against each other, never against a single stock's peer set. */
const INDEX_ETFS = ["SPY", "SPX", "QQQ", "IWM", "DIA", "NDX"];

/** Mega-cap tech/growth names — compared against QQQ plus a few of each other. */
const MEGA_CAP_TECH = [
  "NVDA",
  "AAPL",
  "MSFT",
  "GOOGL",
  "GOOG",
  "AMZN",
  "META",
  "TSLA",
  "AMD",
  "NFLX",
  "COIN",
  "MSTR",
  "ASTS",
];

/** Fallback comparison set for anything outside the two curated groups above. */
const DEFAULT_PEERS = ["SPY", "QQQ", "IWM"];

/** Max comparison tickers returned (excludes the active ticker itself). */
export const DEFAULT_MAX_COMPARISONS = 4;

/**
 * Static comparison set for `activeTicker` — SPY (the always-present market benchmark) plus a
 * couple of sector/peer names, deduped and capped at `max`. Never includes the active ticker
 * itself. Pure and static: no network, no per-member state — the same active ticker always
 * yields the same comparison list.
 */
export function comparisonTickersFor(
  activeTicker: string,
  max: number = DEFAULT_MAX_COMPARISONS
): string[] {
  const active = normalizeVectorTicker(activeTicker);
  const out: string[] = [];
  const add = (t: string) => {
    const n = normalizeVectorTicker(t);
    if (n !== active && !out.includes(n)) out.push(n);
  };

  if (INDEX_ETFS.includes(active)) {
    for (const t of INDEX_ETFS) add(t);
  } else if (MEGA_CAP_TECH.includes(active)) {
    for (const t of MEGA_CAP_TECH) add(t);
  } else {
    for (const t of DEFAULT_PEERS) add(t);
  }

  // SPY leads the strip as the always-present market benchmark (unless SPY is itself active,
  // in which case the index-peer set above already covers it).
  const withBenchmark = active === "SPY" ? out : ["SPY", ...out];
  const seen = new Set<string>();
  const deduped = withBenchmark.filter((t) => {
    if (t === active || seen.has(t)) return false;
    seen.add(t);
    return true;
  });
  return deduped.slice(0, max);
}

export type TickerComparisonRow = {
  ticker: string;
  isActive: boolean;
  regime: ScreenerRegime;
  flipDistancePct: number | null;
  wallStrength: number;
};

/**
 * Build the strip's render rows: the active ticker (if its row is present) followed by whatever
 * comparison tickers actually resolved a row in `rows` — a comparison ticker with no row is
 * silently skipped rather than shown empty/placeholder (house "never fabricate" convention).
 * Returns `[]` when fewer than 2 rows resolve (nothing meaningful to compare), so the component
 * can treat an empty array as "render nothing".
 */
export function buildTickerComparisonRows(
  activeTicker: string,
  rows: readonly VectorUniverseRow[],
  opts: { max?: number } = {}
): TickerComparisonRow[] {
  const active = normalizeVectorTicker(activeTicker);
  const byTicker = new Map(rows.map((r) => [r.ticker, r]));

  const toComparisonRow = (row: VectorUniverseRow): TickerComparisonRow => ({
    ticker: row.ticker,
    isActive: row.ticker === active,
    regime: screenerRegimeOf(row),
    flipDistancePct: flipDistancePct(row),
    wallStrength: wallStrength(row),
  });

  const out: TickerComparisonRow[] = [];
  const activeRow = byTicker.get(active);
  if (activeRow) out.push(toComparisonRow(activeRow));

  for (const t of comparisonTickersFor(active, opts.max)) {
    const row = byTicker.get(t);
    if (row) out.push(toComparisonRow(row));
  }

  return out.length >= 2 ? out : [];
}
