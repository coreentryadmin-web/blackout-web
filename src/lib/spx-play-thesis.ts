import { playThesisBreakDropPts, playThesisBreakScore } from "@/lib/spx-play-config";
import type { SpxPlayDirection } from "@/lib/spx-signals";

export type ThesisBreakDetail = {
  broken: boolean;
  /** Effective threshold on the confluence score axis (primary branch when broken) */
  threshold: number;
  /** Which OR branch fired: drop from entry vs absolute floor */
  trigger: "drop" | "floor" | null;
};

/**
 * Thesis break uses OR logic (either condition flattens):
 *
 * LONG:  score <= entry - dropPts  OR  score <= -floor
 * SHORT: score >= entry + dropPts  OR  score >= +floor
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
    const dropBroken = score <= dropThreshold;
    const floorBroken = score <= floorThreshold;
    const broken = dropBroken || floorBroken;
    const threshold = dropBroken ? dropThreshold : floorBroken ? floorThreshold : dropThreshold;
    const trigger = !broken ? null : dropBroken ? "drop" : "floor";
    return { broken, threshold, trigger };
  }

  const dropThreshold = entryScore + dropPts;
  const floorThreshold = floor;
  const dropBroken = score >= dropThreshold;
  const floorBroken = score >= floorThreshold;
  const broken = dropBroken || floorBroken;
  const threshold = dropBroken ? dropThreshold : floorBroken ? floorThreshold : dropThreshold;
  const trigger = !broken ? null : dropBroken ? "drop" : "floor";
  return { broken, threshold, trigger };
}
