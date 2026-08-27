/**
 * Pure, IO-free plausibility check for a 0DTE STOP exit.
 *
 * WHY THIS EXISTS. Live, 2026-08-27: QQQ committed at 14:12:30.000Z and stopped out at
 * 14:12:30.357Z — 357ms later — printing exit_pnl_pct -77.06% against a plan stop of ~-50%.
 * The underlying's own 1-minute bars for that exact window (14:08-14:16 UTC) show QQQ trading
 * 717.06-718.47, a ~0.15% range. There is no real-market mechanism by which a 0.15% underlying
 * move reprices an option -77% in a third of a second. `evaluateLedgerRowExit`
 * (src/lib/zerodte/exit-sync.ts) treats any fresh mark as authoritative for a stop decision with
 * no check against the underlying's own concurrent move — a single bad/erroneous quote tick (a
 * busted print, a crossed or stale NBBO glitch) can lock in a phantom loss this way.
 *
 * This does NOT change any exit logic — it is read-only evidence gathering, matching this repo's
 * calibration-first convention (see gex-depth-validate.mjs, discovery-recall-probe.mjs): measure
 * how often this actually happens and how severe it is BEFORE designing a guard, so a threshold
 * is picked from a real distribution rather than a hunch.
 *
 * A row is SUSPECT when ALL of:
 *   - it closed via the hard-stop channel (exit_reason === "stop")
 *   - the realized exit was materially worse than the plan's own stop percentage (an "overshoot"
 *     past the intended -50% trigger — real slippage is normally single-digit points, not tens)
 *   - the whole flag→exit window was very short (a real drift-into-stop takes minutes; a
 *     sub-handful-of-seconds gap means the very FIRST post-commit mark already breached it)
 *   - the underlying's own concurrent move cannot plausibly explain the overshoot (a stock/ETF
 *     moving a fraction of a percent cannot legitimately reprice a 0DTE option by tens of points
 *     beyond its stop trigger)
 *
 * Every threshold here is a first pass, not a calibrated cutoff — see the doc comment on
 * DEFAULT_THRESHOLDS below for why each number was picked and what evidence would refine it.
 */

export const DEFAULT_THRESHOLDS = {
  /** Points of exit_pnl_pct beyond the plan's own stop_pct before calling it an "overshoot" —
   *  picked as noticeably larger than ordinary bid/ask slippage on a stop (single digits is
   *  normal; NVDA's own stop today overshot by only 2.9 points). */
  overshootPts: 15,
  /** Seconds from first_flagged_at to exit_at below which "the position never had a chance to
   *  genuinely drift" — a real adverse move takes at least tens of seconds to develop; this
   *  catches the same-tick case (QQQ was 0.357s) while not flagging a normal multi-minute stop. */
  maxLatencySec: 5,
  /** Underlying's own high-low range (%) over the flag→exit window, below which a move this
   *  small cannot plausibly explain a large option repricing on its own. */
  maxUnderlyingMovePct: 1.0,
};

/**
 * @param {{ exit_reason: string, exit_pnl_pct: number | null, first_flagged_at: string, exit_at: string | null, stop_pct?: number }} row
 * @param {number | null} underlyingMovePct - (high-low)/open * 100 over the flag..exit window, or null if bars were unavailable
 * @param {typeof DEFAULT_THRESHOLDS} thresholds
 * @returns {{ suspect: boolean, reason: string, latencySec: number | null, overshootPts: number | null }}
 */
export function evaluateStopPlausibility(row, underlyingMovePct, thresholds = DEFAULT_THRESHOLDS) {
  if (row.exit_reason !== "stop") {
    return { suspect: false, reason: "not a stop exit", latencySec: null, overshootPts: null };
  }
  const stopPct = row.stop_pct ?? -50;
  const exitPct = row.exit_pnl_pct;
  if (exitPct == null) {
    return { suspect: false, reason: "no exit_pnl_pct on the row", latencySec: null, overshootPts: null };
  }
  // Overshoot is signed the same direction as the loss (more negative = further past the stop).
  const overshootPts = stopPct - exitPct; // e.g. -50 - (-77) = 27
  const flagMs = Date.parse(row.first_flagged_at);
  const exitMs = row.exit_at ? Date.parse(row.exit_at) : NaN;
  const latencySec =
    Number.isFinite(flagMs) && Number.isFinite(exitMs) ? Math.max(0, (exitMs - flagMs) / 1000) : null;

  if (overshootPts < thresholds.overshootPts) {
    return { suspect: false, reason: `overshoot ${overshootPts.toFixed(1)}pts is within normal slippage`, latencySec, overshootPts };
  }
  if (latencySec == null) {
    return { suspect: false, reason: "no timestamps to measure latency", latencySec, overshootPts };
  }
  if (latencySec > thresholds.maxLatencySec) {
    return {
      suspect: false,
      reason: `${latencySec.toFixed(1)}s flag-to-exit is long enough for a real drift-into-stop`,
      latencySec,
      overshootPts,
    };
  }
  if (underlyingMovePct == null) {
    return { suspect: false, reason: "underlying bars unavailable — cannot corroborate", latencySec, overshootPts };
  }
  if (underlyingMovePct >= thresholds.maxUnderlyingMovePct) {
    return {
      suspect: false,
      reason: `underlying moved ${underlyingMovePct.toFixed(2)}% in the window — large enough to plausibly explain the overshoot`,
      latencySec,
      overshootPts,
    };
  }
  return {
    suspect: true,
    reason:
      `${overshootPts.toFixed(1)}pts past the plan stop in ${latencySec.toFixed(1)}s while the underlying moved only ` +
      `${underlyingMovePct.toFixed(2)}% — implausible without a bad/erroneous quote tick`,
    latencySec,
    overshootPts,
  };
}
