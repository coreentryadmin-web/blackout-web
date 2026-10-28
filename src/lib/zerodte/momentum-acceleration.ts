// SHADOW-ONLY signal — price-acceleration + key-level-break detection.
//
// WHY THIS EXISTS (2026-10-22, operator directive, "catch bangers like Swift" continuation):
// the existing intraday read (intraday.ts's computeIntradayRead) already carries `trend_5m` (the
// NET direction over the last ~15 closes) and `or_break` (inside/above/below the opening range),
// but neither one answers "is this move SPEEDING UP right now" — trend_5m reads identically for a
// name that moved +0.5% steadily over 15 minutes and one that moved +0.1% for 14 minutes then
// +0.4% in the last one. The second shape (a genuine acceleration) is the one worth reacting to
// fast; the first is just normal drift. This module adds that missing second-derivative read,
// pure and dependency-free, in the exact same unwired-shadow-signal discipline as
// relative-volume.ts (see that file's own header for the full rationale — this module follows it
// byte-for-byte: no caller in the live board/scan/cortex/commit path imports this file, and a
// wiring layer that attaches it additively onto entry_context.shadow_signals is a SEPARATE,
// explicitly-reviewed follow-up, not this file's job).
//
// METHOD: split the supplied bars into two adjacent windows — the RECENT window (the last
// `recentWindowMin` minutes) and the PRIOR window immediately before it (the `priorWindowMin`
// minutes before that). Compute the % price move (last close vs first close) in each window.
// "Accelerating" requires the recent move to be LARGER IN MAGNITUDE than the prior move, in the
// SAME direction (a reversal is a different shape, not acceleration), and to clear a configurable
// noise floor (`minMovePct`) — a real amplitude move, not sub-tick chop reading as "infinite"
// acceleration off a near-zero base.
//
// KEY-LEVEL BREAK: an optional, caller-supplied reference range (e.g. the opening range,
// yesterday's high/low, a round number) — never computed by this module itself, since "which
// level matters" is a product decision the caller makes with real context (today's session vs a
// multi-day one). `confirmed` is true only when BOTH the acceleration direction AND the break
// direction agree — an accelerating move still inside its own reference range, or breaking the
// WRONG way, is reported honestly as `accelerating: true, confirmed: false`, never silently
// upgraded.

export type MomentumBar = { t: number; h: number; l: number; c: number; v?: number };

export type MomentumAccelerationRead = {
  /** Confirmed acceleration direction — null when no real, same-signed acceleration is present. */
  direction: "up" | "down" | null;
  /** % price move across the recent window (signed). Null when there aren't enough bars to form
   *  both windows. */
  recent_move_pct: number | null;
  /** % price move across the window immediately before the recent one (signed). */
  prior_move_pct: number | null;
  /** True iff |recent_move_pct| > |prior_move_pct|, same sign, and |recent_move_pct| clears
   *  `minMovePct` — a genuine, amplifying, same-direction move, not noise or a reversal. */
  accelerating: boolean;
  /** Where the LAST bar's close sits vs the caller-supplied reference range. Null when no
   *  referenceLevel was supplied — never guessed. */
  key_level_break: "above" | "below" | "inside" | null;
  /** True only when `accelerating` AND `key_level_break` agree on direction ("up" + "above", or
   *  "down" + "below"). This is the actionable signal — acceleration alone, or a break alone,
   *  is reported but not confirmed. */
  confirmed: boolean;
};

const DEFAULT_RECENT_WINDOW_MIN = 5;
const DEFAULT_PRIOR_WINDOW_MIN = 5;
/** Below this magnitude, a move is treated as noise regardless of its relative acceleration —
 *  a move from 0.001% to 0.01% is technically "10x" but not a real signal. 0.05% default matches
 *  the existing trend_5m threshold in intraday.ts for consistency across this lane's signals. */
const DEFAULT_MIN_MOVE_PCT = 0.05;

function windowMovePct(bars: MomentumBar[]): number | null {
  if (bars.length < 2) return null;
  const first = bars[0]!.c;
  const last = bars[bars.length - 1]!.c;
  if (!(first > 0)) return null;
  return ((last - first) / first) * 100;
}

/**
 * Pure. `bars` may be supplied in any order (sorted internally by `t`). Splits the tail of the
 * series into a PRIOR window immediately followed by a RECENT window, each spanning
 * `recentWindowMin`/`priorWindowMin` real bars (one bar per minute is assumed, matching every
 * other minute-bar consumer in this lane — a bar with a different cadence should be resampled by
 * the caller first). Returns nulls throughout — never a guess — when there aren't enough bars to
 * form both windows.
 */
export function computeMomentumAcceleration(input: {
  bars: MomentumBar[];
  recentWindowMin?: number;
  priorWindowMin?: number;
  minMovePct?: number;
  referenceLevel?: { high: number; low: number } | null;
}): MomentumAccelerationRead {
  const recentWindowMin = input.recentWindowMin ?? DEFAULT_RECENT_WINDOW_MIN;
  const priorWindowMin = input.priorWindowMin ?? DEFAULT_PRIOR_WINDOW_MIN;
  const minMovePct = input.minMovePct ?? DEFAULT_MIN_MOVE_PCT;

  const sorted = [...input.bars]
    .filter((b) => Number.isFinite(b.t) && Number.isFinite(b.c))
    .sort((a, b) => a.t - b.t);

  const needed = recentWindowMin + priorWindowMin;
  if (sorted.length < needed) {
    return {
      direction: null,
      recent_move_pct: null,
      prior_move_pct: null,
      accelerating: false,
      key_level_break: null,
      confirmed: false,
    };
  }

  const recentBars = sorted.slice(sorted.length - recentWindowMin);
  const priorBars = sorted.slice(sorted.length - needed, sorted.length - recentWindowMin);

  const recentMovePct = windowMovePct(recentBars);
  const priorMovePct = windowMovePct(priorBars);

  let direction: "up" | "down" | null = null;
  let accelerating = false;
  if (recentMovePct != null && priorMovePct != null) {
    const sameSign = (recentMovePct > 0 && priorMovePct >= 0) || (recentMovePct < 0 && priorMovePct <= 0);
    const amplifying = Math.abs(recentMovePct) > Math.abs(priorMovePct);
    const clearsFloor = Math.abs(recentMovePct) >= minMovePct;
    if (sameSign && amplifying && clearsFloor && recentMovePct !== 0) {
      direction = recentMovePct > 0 ? "up" : "down";
      accelerating = true;
    }
  }

  let keyLevelBreak: "above" | "below" | "inside" | null = null;
  if (input.referenceLevel) {
    const last = sorted[sorted.length - 1]!.c;
    const { high, low } = input.referenceLevel;
    keyLevelBreak = last > high ? "above" : last < low ? "below" : "inside";
  }

  const breakAgrees =
    keyLevelBreak != null &&
    ((direction === "up" && keyLevelBreak === "above") || (direction === "down" && keyLevelBreak === "below"));

  return {
    direction,
    recent_move_pct: recentMovePct != null ? Math.round(recentMovePct * 10000) / 10000 : null,
    prior_move_pct: priorMovePct != null ? Math.round(priorMovePct * 10000) / 10000 : null,
    accelerating,
    key_level_break: keyLevelBreak,
    confirmed: accelerating && breakAgrees,
  };
}
