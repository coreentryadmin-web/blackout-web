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

/** Candles must occupy at least this share of the visible price-axis span (member-readable tape).
 *  Raised from 0.16 (2026-08-27, member report — "candles squeezed, fits without scroll"): 0.16
 *  was closer to the axis's OWN eventual floor (`MIN_CANDLE_SHARE_OF_PANE` = 0.35 in
 *  vector-price-range.ts) than it looked, because `AUTO_MIN_ROWS_PER_SIDE` below could still force
 *  MORE rows than even 0.16 allowed (see that constant's comment) — so on a quiet, coarse-stepped
 *  single name the row count AUTO picked assumed a much looser bar than the axis would ultimately
 *  honor, and the two constants disagreeing is what let AUTO settle on a row count the chart then
 *  had to squeeze candles to draw. 0.22 narrows that gap while staying under 0.35, so the row-count
 *  decision and the axis's own guarantee are pulling in the same direction instead of past each
 *  other. */
export const AUTO_MIN_CANDLE_SHARE = 0.22;

/** AUTO never draws fewer rows than this when the timeframe cap allows — single names were self-
 *  limiting to ~7 rows while the rail carries 16+ (measured NVDA 2026-08-24). Clamped to cap.
 *  Lowered from 12 (2026-08-27, same member report): with AUTO_MIN_CANDLE_SHARE at 0.16, this
 *  floor was the ACTUAL controlling number on a quiet coarse-stepped session — the geometry math
 *  would pick as few as 2 rows to hold 16% candle share, and this floor overrode it up to 12
 *  regardless, which is the "AUTO 20" (13 uncapped further by node density's own
 *  VECTOR_WALL_NODES_PER_SIDE ceiling) seen live pulling the axis to ~±14% while the session
 *  traded inside ~1%. 8 keeps meaningfully more wall structure than the old "~7 rows" complaint
 *  this floor was built to fix, without overriding the (now tighter) share target by as much. */
export const AUTO_MIN_ROWS_PER_SIDE = 8;

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
    if (rowAwareSpanPct(spot, strikes, n, 0, hardCapPct) <= maxAxisSpanPct) {
      const minRows = Math.min(AUTO_MIN_ROWS_PER_SIDE, cap);
      return Math.max(minRows, n);
    }
  }
  return Math.min(AUTO_MIN_ROWS_PER_SIDE, cap);
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
