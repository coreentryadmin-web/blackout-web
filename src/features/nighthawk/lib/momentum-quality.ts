/**
 * Night Hawk Legacy — momentum QUALITY, distinct from momentum PRESENCE.
 *
 * `scoreTechnicalSetup` (scorer.ts) already rewards trend/breakout/relative-volume/MA-stack —
 * it answers "is this name moving." It has never answered the two questions a trader actually
 * needs next: is the move SPEEDING UP or losing steam (price acceleration), and has the volume
 * behind it been BUILDING across sessions or is today the only outlier (sustained vs a single-
 * day spike that tends to mean-revert). Both are computable from data the pipeline already
 * fetches — `TechnicalCard`'s `daily_bars` (60 sessions, Polygon) — with ZERO new network calls,
 * which matters here specifically: a 2026-10-12 live incident (docs/audit/findings-staging/
 * 2026-10-13-legacy-target-rescue-dead-cap.md) traced 6 of 20 candidates dropping out of an
 * edition entirely to a 45s per-ticker dossier wall timeout, so adding a new per-ticker fetch to
 * chase this signal would make that exact failure mode worse, not better.
 *
 * Pure, bars-in/read-out — no I/O, directly unit-testable, same shape as this directory's other
 * pure scorers (scoreWallProximity, scoreVexAlignment).
 */
import type { AggBar } from "@/lib/providers/polygon-largo";

export type MomentumPattern = "accelerating" | "decelerating" | "steady";
export type VolumePattern = "sustained" | "single_day_spike" | "normal";

export type MomentumQualityRead = {
  /** (recent-window return %) − (prior-window return %), UNSIGNED to direction — a raw fact
   *  about the tape. Positive means the move picked up speed in whichever direction it was
   *  already going; negative means it's slowing. Null when there isn't enough bar history. */
  recent_window_return_pct: number | null;
  prior_window_return_pct: number | null;
  momentum_pattern: MomentumPattern | null;
  volume_pattern: VolumePattern | null;
  /** How many of the WINDOW sessions immediately before today had volume >= SUSTAIN_RVOL_MIN
   *  times the trailing 20-session average — the "was this building, not just today" count. */
  elevated_volume_sessions: number | null;
};

/** Sessions per acceleration comparison window (recent vs prior). */
export const MOMENTUM_WINDOW_DAYS = 3;
/** Minimum bars needed: WINDOW (recent) + WINDOW (prior) + WINDOW (today's own session) + a
 *  little slack for the volume-average lookback — see computeMomentumQuality's own guard. */
const MIN_BARS_REQUIRED = MOMENTUM_WINDOW_DAYS * 2 + 22;
/** A prior session counts as "elevated" volume at this multiple of the trailing 20-session avg —
 *  matches the existing rel_volume >= 1.5 tier in scoreTechnicalSetup, so "elevated" means the
 *  same thing in both places. */
const SUSTAIN_RVOL_MIN = 1.5;
/** Below this absolute %-point gap between windows, call it "steady" rather than claiming a
 *  direction on what's really noise — most single-digit-dollar/low-ATR names cross this by
 *  chance most days. */
const ACCEL_NOISE_FLOOR_PCT = 1.0;

function windowReturnPct(bars: AggBar[], endExclusive: number): number | null {
  // Return over the WINDOW sessions ending the session BEFORE endExclusive (i.e. bars[endExclusive
  // - WINDOW - 1] -> bars[endExclusive - 1]), so two adjacent, non-overlapping windows can be
  // compared cleanly.
  const startIdx = endExclusive - MOMENTUM_WINDOW_DAYS - 1;
  const endIdx = endExclusive - 1;
  if (startIdx < 0 || endIdx >= bars.length) return null;
  const startClose = bars[startIdx]?.c;
  const endClose = bars[endIdx]?.c;
  if (startClose == null || !Number.isFinite(startClose) || startClose <= 0) return null;
  if (endClose == null || !Number.isFinite(endClose)) return null;
  return ((endClose - startClose) / startClose) * 100;
}

/**
 * Pure read of price-acceleration + volume-sustain pattern from a ticker's own daily bars.
 * `bars` must be in ascending chronological order with the LAST element the most recent
 * (today's, or the latest available) session — the same ordering `TechnicalCard.daily_bars`
 * and every other consumer of Polygon's agg-bar response already assumes.
 *
 * Honest-absence: returns all nulls (never a guessed 0) when there isn't enough real history —
 * a freshly-listed name or a thin bar response must read as "unmeasured," not as "flat."
 */
export function computeMomentumQuality(bars: AggBar[]): MomentumQualityRead {
  const empty: MomentumQualityRead = {
    recent_window_return_pct: null,
    prior_window_return_pct: null,
    momentum_pattern: null,
    volume_pattern: null,
    elevated_volume_sessions: null,
  };
  if (!Array.isArray(bars) || bars.length < MIN_BARS_REQUIRED) return empty;

  const n = bars.length;
  const recentReturn = windowReturnPct(bars, n);
  const priorReturn = windowReturnPct(bars, n - MOMENTUM_WINDOW_DAYS);
  if (recentReturn == null || priorReturn == null) return empty;

  const accelDelta = Math.abs(recentReturn) - Math.abs(priorReturn);
  // Only call it "accelerating"/"decelerating" when the recent move is in the SAME direction as
  // the prior one (a reversal is its own, different thing — not covered here) and the magnitude
  // gap clears the noise floor.
  const sameSign =
    (recentReturn >= 0 && priorReturn >= 0) || (recentReturn <= 0 && priorReturn <= 0);
  let momentumPattern: MomentumPattern | null = null;
  if (Math.abs(accelDelta) < ACCEL_NOISE_FLOOR_PCT) {
    momentumPattern = "steady";
  } else if (sameSign) {
    momentumPattern = accelDelta > 0 ? "accelerating" : "decelerating";
  } else {
    momentumPattern = "steady"; // a sign flip isn't "deceleration" — don't overclaim one
  }

  // Volume-sustain: trailing-20-session average, EXCLUDING today (mirrors the existing
  // rel_volume field's own avgVol20 recipe in polygon-largo.ts, recomputed here rather than
  // threaded through TechnicalCard so this stays a self-contained, independently testable
  // pure function — a disclosed approximation, not a drifted duplicate: both use the same
  // trailing-20, excl.-today window).
  const priorVols = bars
    .slice(-21, -1)
    .map((b) => b.v ?? 0)
    .filter((v) => v > 0);
  const avgVol20 = priorVols.length >= 5 ? priorVols.reduce((s, v) => s + v, 0) / priorVols.length : null;

  let elevatedSessions: number | null = null;
  let volumePattern: VolumePattern | null = null;
  if (avgVol20 != null && avgVol20 > 0) {
    // The WINDOW sessions immediately before today — today's own volume is already scored by
    // the existing rel_volume field, this is specifically asking about the sessions BEFORE it.
    const priorSessions = bars.slice(-1 - MOMENTUM_WINDOW_DAYS, -1);
    elevatedSessions = priorSessions.filter((b) => (b.v ?? 0) / avgVol20 >= SUSTAIN_RVOL_MIN).length;
    const todayVol = bars.at(-1)?.v ?? 0;
    const todayElevated = todayVol > 0 && todayVol / avgVol20 >= SUSTAIN_RVOL_MIN;
    if (todayElevated && elevatedSessions >= 2) {
      volumePattern = "sustained";
    } else if (todayElevated && elevatedSessions === 0) {
      volumePattern = "single_day_spike";
    } else {
      volumePattern = "normal";
    }
  }

  return {
    recent_window_return_pct: Number(recentReturn.toFixed(2)),
    prior_window_return_pct: Number(priorReturn.toFixed(2)),
    momentum_pattern: momentumPattern,
    volume_pattern: volumePattern,
    elevated_volume_sessions: elevatedSessions,
  };
}

/**
 * Score a candidate's momentum QUALITY for the composite — additive, bounded, direction-aware.
 * Rewards acceleration/sustained volume ALIGNED with the play's own direction; penalizes
 * deceleration or a single-day-spike pattern (classic exhaustion signature — a late entry on a
 * move that already ran, chasing a print the tape itself is no longer confirming).
 *
 * `read.recent_window_return_pct` carries the move's own sign, so "aligned" means a LONG whose
 * recent window return is positive (or a SHORT whose recent window return is negative) — a
 * candidate accelerating in the OPPOSITE direction to the proposed trade is not rewarded for
 * "momentum" at all, it's evidence against the thesis and scores 0 here (the directional
 * disagreement itself is already the flow/technicals' job to catch elsewhere in the composite).
 */
export function scoreMomentumQuality(
  read: MomentumQualityRead,
  direction: "long" | "short"
): number {
  if (read.recent_window_return_pct == null) return 0;
  const movedWithDirection =
    direction === "long" ? read.recent_window_return_pct > 0 : read.recent_window_return_pct < 0;

  let score = 0;
  if (movedWithDirection) {
    if (read.momentum_pattern === "accelerating") score += 5;
    else if (read.momentum_pattern === "decelerating") score -= 3;

    if (read.volume_pattern === "sustained") score += 3;
    else if (read.volume_pattern === "single_day_spike") score -= 2;
  }

  return Math.max(-5, Math.min(8, score));
}
