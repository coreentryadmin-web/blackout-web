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
 * section to "Desk context" and moved ONLY its NH-direction/0DTE-stance content into
 * `crossDeskCoaching` inside the narrative, deliberately RETAINING NH outcome-history and
 * flow-anomaly coaching as supplementary, non-duplicate content (`deskConsensusSection`,
 * play-brief-intel.ts). So "Desk context" is excluded here too, not remapped to the new title —
 * `crossDeskCoaching` does not cover what's left in it, and adding it back under its new name
 * would repeat the exact silent-deletion bug this comment is warning about, for a different
 * section.
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
