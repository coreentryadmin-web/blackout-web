import type { IChartApi, UTCTimestamp } from "lightweight-charts";
import { lastSessionBars } from "@/features/vector/lib/vector-key-levels";
import { centeredLiveVisibleLogicalRange } from "@/features/vector/lib/vector-candle-render";

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
/** Frame ~48 bars with the latest candle near center — default live desk load. */
export function applyCenteredLiveViewport(chart: IChartApi, barCount: number): boolean {
  const range = centeredLiveVisibleLogicalRange(barCount);
  if (!range) return false;
  chart.timeScale().setVisibleLogicalRange(range);
  return true;
}

/**
 * Scale a visible logical range around its own center by `factor` (member request, 2026-08-27:
 * explicit zoom in/out buttons). `factor < 1` zooms IN (narrower range), `factor > 1` zooms OUT.
 * Floored at `minSpan` so a member cannot zoom in far enough to make the range degenerate (or
 * negative-width, which lightweight-charts would reject). Pure so the button math is testable
 * without a live chart instance — VectorChart's stepZoom is the only caller.
 */
export function zoomedLogicalRange(
  range: { from: number; to: number },
  factor: number,
  minSpan: number
): { from: number; to: number } | null {
  const span = range.to - range.from;
  if (!(span > 0) || !(factor > 0)) return null;
  const center = (range.from + range.to) / 2;
  const half = Math.max((span * factor) / 2, minSpan / 2);
  return { from: center - half, to: center + half };
}

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

/**
 * Frame the chart on the newest session rather than fitContent()-ing the whole multi-day seed.
 *
 * NOT gated on the DTE horizon (was `&& dteHorizon === "0dte"` until 2026-08-07). That condition
 * made the fix apply to SPX/SPY/QQQ only, because `/vector/page.tsx` sets `defaultDteHorizon` to
 * "0dte" for `VECTOR_ORACLE_TICKERS` and leaves it undefined for everything else — so every single
 * name (AMD, META, …) kept the broken behaviour #868 was written to fix, and its own docstring
 * describes the symptom exactly: "fitContent() on the full array compresses today's RTH into a left
 * sliver — beads look like one or two columns."
 *
 * The horizon was never the right predicate. The invariant is about DOMAIN, not lens: the seed
 * carries ~3 sessions of bars while `trimHistoryToSession` cuts the wall rail to ONE, so on any
 * horizon a full-seed fit leaves ~75% of the x-axis with no bead data by construction. Framing the
 * newest session is what makes the two domains agree, and it is correct for every ticker and lens.
 */
export function wantsSessionOverviewViewport(
  viewport: "session" | "live",
  liveFollowEnabled: boolean
): boolean {
  return viewport === "session" && !liveFollowEnabled;
}
