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

/** Collapsed sections whose body must survive inside Trade manager read (not silently dropped). */
const FOLD_BODY_INTO_NARRATIVE = new Set(["Book context"]);

/**
 * Filter redundant intel sections when Trade manager read is leading.
 * Always keeps setup, catalysts, freshness, watch levels, lessons.
 */
export function collapseRedundantIntelSections(
  sections: RichSection[],
  opts: { hasNarrative: boolean; bucket: "watch" | "open" | "closed" },
): RichSection[] {
  if (!opts.hasNarrative) return sections;

  const foldBodies: string[] = [];
  const filtered = sections.filter((s) => {
    if (!NARRATIVE_COVERED_TITLES.has(s.title)) return true;
    if (FOLD_BODY_INTO_NARRATIVE.has(s.title) && s.body.trim()) {
      foldBodies.push(s.body);
    }
    return false;
  });

  const dropped = sections.length - filtered.length;
  if (dropped === 0) return filtered;

  const narrativeIdx = filtered.findIndex((s) => s.title === "Trade manager read");
  if (narrativeIdx < 0) return filtered;

  const note =
    `_Desk detail for ${dropped} section${dropped === 1 ? "" : "s"} folded into Trade manager read above — expand via follow-up chips or Open Largo._`;
  const narrative = filtered[narrativeIdx]!;
  let body = narrative.body;
  if (foldBodies.length && !foldBodies.every((b) => body.includes(b))) {
    body = `${body}\n\n${foldBodies.join("\n\n")}`;
  }
  if (!body.includes("folded into Trade manager read")) {
    body = `${body}\n\n${note}`;
  }
  filtered[narrativeIdx] = { ...narrative, body };

  return filtered;
}
