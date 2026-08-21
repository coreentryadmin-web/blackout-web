/**
 * Adaptive NODES=AUTO — as many bead rows as fit while candles keep a minimum share of the pane.
 *
 * On coarse strike ladders (NVDA $2.50 steps ≈ 1.14% of price) ten rows force the price axis
 * to span ~±12% while the session range is ~1%, collapsing candles to a sliver. SPX (5-pt steps
 * ≈ 0.065%) fits ten rows inside ~1% — AUTO stays at the timeframe cap there.
 *
 * Manual picks (6/8/12/16/20) are unchanged: a member who wants more rows accepts smaller candles.
 */

import { rowAwareSpanPct, BEAD_VIEW_MAX_PCT, type PriceRange } from "./vector-price-range";
import { VECTOR_WALL_NODES_PER_SIDE } from "./vector-bar-timeframes";
import type { VectorNodeDensity } from "./vector-node-density";
import { resolveNodeCount } from "./vector-node-density";

/** Candles must occupy at least this share of the visible price-axis span (member-readable tape). */
export const AUTO_MIN_CANDLE_SHARE = 0.2;

export type AdaptiveNodeInputs = {
  spot: number;
  /** Strike ladder used to measure median step (walls + trail candidates). */
  strikes: readonly number[];
  /** Session candle high/low from the visible bar seed. */
  candleRange: PriceRange;
  /** Timeframe AUTO cap from wallCountForTimeframe / wallCountForHorizon. */
  tfAutoCount: number;
  minCandleShare?: number;
  hardCapPct?: number;
};

/**
 * Largest row count ≤ tfAutoCount whose row-aware window keeps candles ≥ minCandleShare of pane.
 *
 * Uses the same rowAwareSpanPct geometry as session overview (#2326) — pure, unit-testable,
 * no chart instance required.
 */
export function adaptiveAutoNodeCount({
  spot,
  strikes,
  candleRange,
  tfAutoCount,
  minCandleShare = AUTO_MIN_CANDLE_SHARE,
  hardCapPct = BEAD_VIEW_MAX_PCT,
}: AdaptiveNodeInputs): number {
  const cap = Math.max(1, Math.min(VECTOR_WALL_NODES_PER_SIDE, Math.floor(tfAutoCount) || 1));
  if (!(spot > 0) || !(minCandleShare > 0)) return cap;

  const candleSpan = candleRange.maxValue - candleRange.minValue;
  if (!(candleSpan > 0)) return cap;

  const maxAxisSpanPct = candleSpan / spot / minCandleShare;
  if (!Number.isFinite(maxAxisSpanPct) || maxAxisSpanPct <= 0) return cap;

  if (rowAwareSpanPct(spot, strikes, cap, 0, hardCapPct) <= maxAxisSpanPct) return cap;

  for (let n = cap - 1; n >= 1; n--) {
    if (rowAwareSpanPct(spot, strikes, n, 0, hardCapPct) <= maxAxisSpanPct) return n;
  }
  return 1;
}

/** High/low from intraday bars — null when the session seed is empty or flat. */
export function candleRangeFromBars(
  bars: ReadonlyArray<{ high?: number; low?: number }>
): PriceRange | null {
  let min = Infinity;
  let max = -Infinity;
  for (const b of bars) {
    if (Number.isFinite(b.low)) min = Math.min(min, b.low!);
    if (Number.isFinite(b.high)) max = Math.max(max, b.high!);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  return { minValue: min, maxValue: max };
}

/** Union strike keys from wall ladders for step measurement. */
export function strikesForAdaptiveMeasure(
  ...lists: ReadonlyArray<readonly number[]>
): number[] {
  const set = new Set<number>();
  for (const list of lists) {
    for (const s of list) {
      if (Number.isFinite(s) && s > 0) set.add(s);
    }
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Resolve NODES for the chart: manual picks unchanged; AUTO adapts to ladder + candle range.
 */
export function resolveEffectiveNodeCount(
  density: VectorNodeDensity,
  tfAutoCount: number,
  adaptive: AdaptiveNodeInputs | null
): number {
  if (density !== "auto" || adaptive == null) {
    return resolveNodeCount(density, tfAutoCount);
  }
  return adaptiveAutoNodeCount({ ...adaptive, tfAutoCount });
}
