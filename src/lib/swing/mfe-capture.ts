/**
 * Shared MFE-capture math for closed swing plays.
 *
 * "Captured X% of the peak move" is only a meaningful sentence when the exit itself is still a
 * gain (0% <= exit <= peak, or an overshoot past peak) — the ratio exit/peak then reads as a real
 * fraction of the favorable excursion the member banked. Once the exit goes NEGATIVE the play has
 * round-tripped past breakeven into a realized loss, and exit/peak stops being a "capture" at all:
 * peak +25.7%, exit -40.8% divides to -158.9%, a number with no honest reading as a percentage of
 * anything captured. It is a DIFFERENT event (round-trip to a loss), not a worse version of the
 * same one, so it gets its own outcome rather than being forced through the capture formula.
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
