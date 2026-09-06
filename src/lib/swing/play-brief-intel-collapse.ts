/**
 * Collapse intel sections already covered by Trade manager read narrative.
 * Keeps the brief scannable — detail lives in bullets, not duplicated dumps.
 */
import type { RichSection } from "@/lib/bie/rich-narrative";

/**
 * Section titles omitted when a narrative block is present (coaching already spoke).
 *
 * "Book context" is deliberately NOT in this set — see #4116/#4123: post-#4116 it is the ONLY
 * concentration source (no narrative bullet covers it).
 *
 * "Desk consensus" was ALSO deliberately removed (was never "Desk context" here — that entry
 * never matched anything, since #4111 renamed the section to "Desk context" and moved ONLY its
 * NH-direction/0DTE-stance content into `crossDeskCoaching`, while deliberately KEEPING NH
 * outcome-history and flow-anomaly content supplementary in `deskConsensusSection`
 * (play-brief-intel.ts). Naively "fixing" the stale string by renaming it to "Desk context" would
 * silently delete that supplementary content — the exact bug class #4116/#4123 fixed for Book
 * context, just for a different section. Do not add "Desk context" here without first confirming
 * `crossDeskCoaching` covers everything `deskConsensusSection` renders.
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
