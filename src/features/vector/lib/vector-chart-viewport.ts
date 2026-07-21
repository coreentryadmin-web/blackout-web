import type { IChartApi, UTCTimestamp } from "lightweight-charts";
import { lastSessionBars } from "@/features/vector/lib/vector-key-levels";

/** Right-edge breathing room (in bar slots) so the latest bead cluster is not glued to the axis. */
const SESSION_VIEWPORT_RIGHT_PAD = 2;
/** Trailing time padding so the last candle/bead is not flush to the price axis. */
const SESSION_VIEWPORT_TIME_PAD_SEC = 5 * 60;

/**
 * Visible logical range for the newest ET session only. Seed bars carry multiple sessions;
 * fitContent() on the full array compresses today's RTH into a left sliver — beads look like
 * one or two columns. Session overview instead frames just the trailing day.
 */
export function sessionVisibleLogicalRange(
  bars: readonly { time: number }[]
): { from: number; to: number } | null {
  if (!bars.length) return null;
  const sessionLen = lastSessionBars(bars).length;
  if (sessionLen <= 0) return null;
  const from = bars.length - sessionLen;
  const to = bars.length - 1;
  return { from, to: to + SESSION_VIEWPORT_RIGHT_PAD };
}

/** Time range for the newest ET session — stable when bar aggregation/count changes. */
export function sessionVisibleTimeRange(
  bars: readonly { time: number }[],
  paddingSec = SESSION_VIEWPORT_TIME_PAD_SEC
): { from: UTCTimestamp; to: UTCTimestamp } | null {
  const session = lastSessionBars(bars);
  if (!session.length) return null;
  return {
    from: session[0]!.time as UTCTimestamp,
    to: (session[session.length - 1]!.time + paddingSec) as UTCTimestamp,
  };
}

/** Fit the chart to the current session's bars (not the full multi-day seed). */
export function applySessionOverviewViewport(
  chart: IChartApi,
  bars: readonly { time: number }[]
): boolean {
  const timeRange = sessionVisibleTimeRange(bars);
  if (timeRange) {
    chart.timeScale().setVisibleRange(timeRange);
    return true;
  }
  const range = sessionVisibleLogicalRange(bars);
  if (!range) return false;
  chart.timeScale().setVisibleLogicalRange(range);
  return true;
}
