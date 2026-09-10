/**
 * Shared MFE-capture math for swing plays — CLOSED-play post-mortems (exit pnl vs peak) AND
 * LIVE/open-play reads (current pnl vs peak, e.g. the "Gave back X% from peak" trade-manager
 * bullets in play-brief-narrative.ts / play-brief-narrative-coaching.ts / play-brief-intel.ts,
 * FINDINGS 2026-09-10). The math is identical either way — `exitPnlPct` is really just "the pnl
 * to compare against peak"; a live call site passes the play's current `pnlPct` and `null` for
 * `mfeCapturePct` (that field only ever exists post-close).
 *
 * "Captured X% of the peak move" is only a meaningful sentence when the pnl being compared is
 * still a gain (0% <= pnl <= peak, or an overshoot past peak) — the ratio pnl/peak then reads as a
 * real fraction of the favorable excursion the member has banked (closed) or is still holding
 * (live). Once that pnl goes NEGATIVE the play has round-tripped past breakeven into a loss (or,
 * for a live play, into a rejoinder to keep — same read either way), and pnl/peak stops being a
 * "capture" at all: peak +25.7%, pnl -40.8% divides to -158.9%, a number with no honest reading as
 * a percentage of anything captured. It is a DIFFERENT event (round-trip to a loss), not a worse
 * version of the same one, so it gets its own outcome rather than being forced through the
 * capture formula.
 */

export type MfeCaptureOutcome =
  | { kind: "capture"; capturePct: number }
  | { kind: "round_trip"; peakPct: number; exitPnlPct: number };

/**
 * `mfeCapturePct` is the authoritative field when the server supplies it (currently never
 * populated — see FINDINGS — so the ratio fallback is what production actually serves today).
 * Returns null when there isn't enough data to say anything (no peak, or peak <= 0).
 */
export function mfeCaptureOutcome(
  exitPnlPct: number | null | undefined,
  peak: number | null | undefined,
  mfeCapturePct: number | null | undefined,
): MfeCaptureOutcome | null {
  if (exitPnlPct == null || peak == null || !Number.isFinite(exitPnlPct) || !Number.isFinite(peak)) return null;
  if (peak <= 0) return null;
  if (mfeCapturePct != null && Number.isFinite(mfeCapturePct)) {
    return { kind: "capture", capturePct: mfeCapturePct };
  }
  if (exitPnlPct < 0) {
    return { kind: "round_trip", peakPct: peak, exitPnlPct };
  }
  return { kind: "capture", capturePct: (exitPnlPct / peak) * 100 };
}
