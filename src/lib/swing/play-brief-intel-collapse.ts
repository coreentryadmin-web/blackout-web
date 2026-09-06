/**
 * Collapse intel sections already covered by Trade manager read narrative.
 * Keeps the brief scannable — detail lives in bullets, not duplicated dumps.
 */
import type { RichSection } from "@/lib/bie/rich-narrative";

/**
 * Section titles omitted when a narrative block is present (coaching already spoke).
 *
 * "Book context" is deliberately NOT in this set: `bookContextSection` (play-brief-intel.ts) is
 * the ONLY place that renders book-concentration/conflict warnings since #4116 removed the
 * duplicate `bookContextCoaching` narrative bullet. Collapsing it here would silently delete the
 * warning for any member with a theme-overlapping book — there is no narrative bullet left to
 * "fold into".
 *
 * "Desk consensus" (the old title) was ALSO stale here and matched nothing — #4111 renamed that
 * section to "Desk context" and moved NH-direction/0DTE-stance into `crossDeskCoaching`.
 * Post-#4128, `deskConsensusSection` renders ONLY NH outcome history (flow anomalies live in
 * `flowNarrative` + `flowIntelSection`). "Desk context" stays excluded — `crossDeskCoaching`
 * does not cover outcome history, and remapping the stale title would silently delete it.
 */
const NARRATIVE_COVERED_TITLES = new Set([
  "Lane rank",
  "Levels on chart",
  "GEX posture",
  "Wall dynamics",
  "Flow & positioning",
  "Macro tape",
  "Hold plan",
  "Vector desk",
]);

/**
 * Filter redundant intel sections when Trade manager read is leading.
 * Always keeps setup, catalysts, freshness, watch levels, lessons.
 */
export function collapseRedundantIntelSections(
  sections: RichSection[],
  opts: { hasNarrative: boolean; bucket: "watch" | "open" | "closed" },
): RichSection[] {
  if (!opts.hasNarrative) return sections;
  // Closed briefs only narrate a short post-mortem — GEX/wall/macro/flow sections are not folded in.
  if (opts.bucket === "closed") return sections;

  const filtered = sections.filter((s) => !NARRATIVE_COVERED_TITLES.has(s.title));

  const dropped = sections.length - filtered.length;
  if (dropped === 0) return filtered;

  const narrativeIdx = filtered.findIndex((s) => s.title === "Trade manager read");
  if (narrativeIdx < 0) return filtered;

  const note =
    `_Desk detail for ${dropped} section${dropped === 1 ? "" : "s"} folded into Trade manager read above — expand via follow-up chips or Open Largo._`;
  const narrative = filtered[narrativeIdx]!;
  filtered[narrativeIdx] = {
    ...narrative,
    body: narrative.body.includes("folded into Trade manager read")
      ? narrative.body
      : `${narrative.body}\n\n${note}`,
  };

  return filtered;
}
