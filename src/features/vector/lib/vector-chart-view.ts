import type { VectorDailyUnit } from "@/features/vector/lib/vector-daily-bars";

/** Local mirror of VectorDailyChart's view union. Declared here rather than imported from the
 *  component so lib/ never depends on components/ — the cycle would be type-only and erased at
 *  build, but the layering inversion is real and would invite a runtime one later. */
type VectorHistoricalView = VectorDailyUnit | "4H";

/**
 * Default number of bars VISIBLE on first paint of the historical (1D/1W/4H) chart.
 *
 * WHY THIS EXISTS. The chart used to call `timeScale().fitContent()`, which forces every loaded
 * bar into the viewport. `daily-bars/route.ts` deliberately serves ~2 trading years (~500 daily
 * bars) because the 200-period SMA needs 200 of them — so fitContent squeezed ~500 candles into
 * roughly 900px: about 1.8px per candle, with the "1D" tab showing an x-axis spanning two years.
 * That is the "candles are too small to see" report, and it is a VIEWPORT problem, not a data one.
 *
 * The fix is to keep fetching the full history (the SMAs still need it) and only CHANGE what is
 * initially in view. Users pan/zoom out to reach the rest; nothing is removed.
 *
 * Counts are chosen so a candle lands at roughly 8-12px on a ~900px canvas, which is the range
 * where a body and both wicks are actually legible:
 *   1D  ~90 bars  → about 4.5 months of trading days
 *   1W  ~78 bars  → about 18 months
 *   4H  ~120 bars → about 30 trading days (6 bars/day)
 */
export function defaultVisibleBars(unit: VectorHistoricalView): number {
  if (unit === "4H") return 120;
  if (unit === "1W") return 78;
  return 90;
}

/**
 * The logical range to show on first paint: the most RECENT `defaultVisibleBars(unit)` bars.
 *
 * lightweight-charts logical coordinates are bar indices, and `to` is deliberately set one bar
 * PAST the last index so the newest candle is not glued to the right edge — traders read the most
 * recent bar constantly and a flush edge makes its wick ambiguous.
 *
 * Returns null when there is nothing to frame (no bars) or when the history is already shorter
 * than the target window — in that case the caller should fall back to fitContent(), because
 * pinning a range wider than the data would render dead space on the left.
 */
export function initialLogicalRange(
  barCount: number,
  unit: VectorHistoricalView
): { from: number; to: number } | null {
  if (!Number.isFinite(barCount) || barCount <= 0) return null;
  const want = defaultVisibleBars(unit);
  if (barCount <= want) return null;
  return { from: barCount - want, to: barCount + 1 };
}
