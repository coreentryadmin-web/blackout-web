/**
 * Collapse intel sections already covered by Trade manager read narrative.
 * Keeps the brief scannable — detail lives in bullets, not duplicated dumps.
 */
import type { RichSection } from "@/lib/bie/rich-narrative";

/** Section titles omitted when a narrative block is present (coaching already spoke). */
const NARRATIVE_COVERED_TITLES = new Set([
  "Book context",
  "Lane rank",
  "Levels on chart",
  "GEX posture",
  "Wall dynamics",
  "Flow & positioning",
  "Macro tape",
  "Desk consensus",
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

  const bookSection = sections.find((s) => s.title === "Book context");
  const filtered = sections.filter((s) => !NARRATIVE_COVERED_TITLES.has(s.title));

  const dropped = sections.length - filtered.length;
  if (dropped === 0) return filtered;

  const narrativeIdx = filtered.findIndex((s) => s.title === "Trade manager read");
  if (narrativeIdx < 0) return filtered;

  const narrative = filtered[narrativeIdx]!;
  let body = narrative.body;

  // Book overlap must survive collapse — #4116 removed duplicate coaching bullets from
  // narrative, so dropping the dedicated section without folding would hide concentration.
  if (bookSection?.body.trim()) {
    const folded = bookSection.body
      .split("\n\n")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => (p.startsWith("• ") ? p : `• ${p}`))
      .join("\n");
    if (folded && !body.includes(folded.slice(0, 48))) {
      body = body ? `${body}\n\n${folded}` : folded;
    }
  }

  const note =
    `_Desk detail for ${dropped} section${dropped === 1 ? "" : "s"} folded into Trade manager read above — expand via follow-up chips or Open Largo._`;
  filtered[narrativeIdx] = {
    ...narrative,
    body: body.includes("folded into Trade manager read")
      ? body
      : `${body}\n\n${note}`,
  };

  return filtered;
}
