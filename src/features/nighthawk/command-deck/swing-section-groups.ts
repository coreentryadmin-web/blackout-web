// src/features/nighthawk/command-deck/swing-section-groups.ts — groups the SWING lane's already-sorted
// play list by serving.ts's seven serving sections, so the board can render them as visually DISTINCT
// rails instead of one flat concatenated list (FINDINGS 2026-08-06 P2). serving.ts's own header states the
// whole reason the router exists: "the desk cannot show a member 200 swing candidates as one undifferentiated
// list" — but until this module, `HorizonDeck`/`CommandDeck` did exactly that, concatenating all seven
// sections in fixed order with the section surviving only as a small per-card text badge.
//
// Pure grouping only — never drops a play. A play with no servingSection (shouldn't happen for the SWING
// lane; serving.ts always stamps one) lands in a fail-safe "UNSECTIONED" bucket rather than disappearing.

import type { TerminalPlay } from "./types";
import { SWING_SERVING_SECTIONS, type SwingServingSection } from "@/lib/swing/serving";

export type SwingSectionGroupKey = SwingServingSection | "UNSECTIONED";

export interface SwingSectionGroup {
  key: SwingSectionGroupKey;
  label: string;
  hint: string;
  plays: TerminalPlay[];
}

export const SWING_SECTION_LABELS: Record<SwingSectionGroupKey, string> = {
  COMMIT_NOW: "Commit now",
  WAITING_FOR_ENTRY: "Waiting for entry",
  WATCH: "Watch",
  RESEARCH: "Research",
  MANAGING: "Managing",
  SCALING_OUT: "Scaling out",
  EXITING: "Exiting",
  UNSECTIONED: "Other",
};

const SWING_SECTION_HINTS: Record<SwingSectionGroupKey, string> = {
  COMMIT_NOW: "Triggered, clean entry geometry — actionable now.",
  WAITING_FOR_ENTRY: "Thesis live, no clean fill yet.",
  WATCH: "Forming, or under the commit floor — not yet actionable.",
  RESEARCH: "Unclassified, invalidated, or degraded — needs work before serving.",
  MANAGING: "Open position, thesis intact — hold to plan.",
  SCALING_OUT: "Open position, banking a tranche or trailing the runner.",
  EXITING: "Open position, exit signalled.",
  UNSECTIONED: "No serving section stamped on this play.",
};

/** Canonical render order: the four pre-entry sections, then the three live-position sections, then the
 *  fail-safe catch-all last (it should ordinarily be empty). */
const GROUP_ORDER: readonly SwingSectionGroupKey[] = [...SWING_SERVING_SECTIONS, "UNSECTIONED"];

/**
 * Groups an already-sorted SWING play list into its serving sections, preserving each play's relative
 * order within its section. Returns ONLY non-empty groups, in canonical order. Never drops a play.
 */
export function groupSwingSections(sorted: readonly TerminalPlay[]): SwingSectionGroup[] {
  const buckets = new Map<SwingSectionGroupKey, TerminalPlay[]>();
  for (const p of sorted) {
    const key: SwingSectionGroupKey = p.servingSection ?? "UNSECTIONED";
    const list = buckets.get(key);
    if (list) list.push(p);
    else buckets.set(key, [p]);
  }
  const groups: SwingSectionGroup[] = [];
  for (const key of GROUP_ORDER) {
    const plays = buckets.get(key);
    if (plays && plays.length > 0) {
      groups.push({ key, label: SWING_SECTION_LABELS[key], hint: SWING_SECTION_HINTS[key], plays });
    }
  }
  return groups;
}
