/**
 * Pure render-gating predicates for the PlayTerminal management panel — extracted so the
 * "who sees which exit view" rules are unit-testable without rendering React (same
 * extract-pure discipline as zerodte-sources / use-live-marks).
 *
 * The rules encode two correctness constraints:
 *  - The 15:30-ET time-stop countdown is a 0DTE-only, still-open discipline. A Swing/LEAPS/
 *    Legacy position runs for days/weeks, so a "flat by 15:30 today" countdown would be flatly
 *    false and member-misleading; a CLOSED 0DTE row has nothing left to time out.
 *  - A CREDIT iron condor must NEVER draw a DIRECTIONAL exit view (the trim-scale ⅓/⅓ ladder or
 *    the −50/+100 ratchet track) — its profit comes from decay/pin, not a rising long premium,
 *    so those ladders are inverted for it.
 */
import type { TerminalPlay } from "./types";

/** The 15:30-ET time-stop countdown shows ONLY for a still-open 0DTE row. */
export function showsTimeStopClock(play: Pick<TerminalPlay, "horizon" | "status">): boolean {
  return play.horizon === "ZERO_DTE" && play.status !== "CLOSED";
}

/** The real trim-scale ladder shows ONLY for a non-condor row whose FROZEN policy is trim_scale
 *  (dormant under the prod ratchet default; renders when that mode is enabled). */
export function showsTrimScaleLadder(
  play: Pick<TerminalPlay, "exitModel" | "exitPolicy" | "isCondor">
): boolean {
  return play.exitModel === "SCALE_OUT" && play.exitPolicy?.policy === "trim_scale" && play.isCondor !== true;
}

/** The directional −50/+100 ratchet track shows ONLY for a non-condor RATCHET row with a track
 *  position — the prod-default view for a real directional 0DTE play. */
export function showsRatchetTrack(
  play: Pick<TerminalPlay, "exitModel" | "isCondor" | "progress">
): boolean {
  return play.isCondor !== true && play.exitModel === "RATCHET" && play.progress != null;
}
