import { playThesisBreakDropPts, playThesisBreakScore } from "@/lib/spx-play-config";
import type { SpxPlayDirection } from "@/lib/spx-signals";

export type ThesisBreakDetail = {
  broken: boolean;
  /** Effective threshold on the confluence score axis */
  threshold: number;
  /** Which OR branch bound first: drop from entry vs absolute floor */
  trigger: "drop" | "floor" | null;
};

/**
 * Thesis break uses OR logic (either condition flattens):
 *
 * LONG:  score <= entry - dropPts  OR  score <= -floor
 * SHORT: score >= entry + dropPts  OR  score >= +floor
 *
 * Implemented as a single comparison against the tighter threshold:
 * - Long:  score <= max(entry - drop, -floor)   — e.g. entry 44 → exit at 32, not -40
 * - Short: score >= min(entry + drop, +floor)   — e.g. entry -44 → exit at -32, not +40
 */
export function evaluateThesisBreak(
  direction: SpxPlayDirection,
  score: number,
  entryScore: number,
  opts?: { dropPts?: number; floor?: number }
): ThesisBreakDetail {
  const dropPts = opts?.dropPts ?? playThesisBreakDropPts();
  const floor = opts?.floor ?? playThesisBreakScore();

  if (direction === "long") {
    const dropThreshold = entryScore - dropPts;
    const floorThreshold = -floor;
    const threshold = Math.max(dropThreshold, floorThreshold);
    const broken = score <= threshold;
    const trigger = !broken ? null : dropThreshold >= floorThreshold ? "drop" : "floor";
    return { broken, threshold, trigger };
  }

  const dropThreshold = entryScore + dropPts;
  const floorThreshold = floor;
  const threshold = Math.min(dropThreshold, floorThreshold);
  const broken = score >= threshold;
  const trigger = !broken ? null : dropThreshold <= floorThreshold ? "drop" : "floor";
  return { broken, threshold, trigger };
}
