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
 *
 * "Lane rank" is in this set, but unlike every other title here it is NOT unconditionally
 * covered — `laneRankCoaching` (play-brief-narrative-coaching.ts) deliberately returns `null`
 * (stays silent) for a comfortably-good-but-not-top-3 position: well above the lane median
 * (`deltaFromMedian >= 10`) but ranked below #3 (e.g. rank 5). That silence is a deliberate
 * editorial choice (not every real, honest rank/score fact earns a bullet), but
 * `laneRankSection` (play-brief-intel.ts) still renders the real rank/score/median/leader for
 * that same position — so dropping "Lane rank" here and claiming it was "folded into Trade
 * manager read" would be false for that one band. See `collapseRedundantIntelSections`'s own
 * `laneRankFolded` opt, which the caller derives from the SAME `laneRankCoaching` predicate
 * rather than trusting this static list for this one title.
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
  opts: {
    hasNarrative: boolean;
    bucket: "watch" | "open" | "closed";
    /**
     * Whether `laneRankCoaching(play, laneRows)` actually produced a bullet for THIS play's real
     * (rank, deltaFromMedian) — the caller recomputes the exact same predicate the narrative
     * generator uses (see `NARRATIVE_COVERED_TITLES`'s own doc comment on "Lane rank" above),
     * rather than this function trusting a static title-match the way it safely can for every
     * other title here. Omitted/false is the SAFE default: "Lane rank" is kept (never dropped)
     * and the "folded into Trade manager read" note never claims coverage it can't prove — a
     * caller that forgets to pass this loses the collapse for that one section, never gains a
     * false claim.
     */
    laneRankFolded?: boolean;
  },
): RichSection[] {
  if (!opts.hasNarrative) return sections;

  // Closed post-mortem narrative only runs closedCoaching — it does NOT narrate GEX/walls/macro/flow.
  // Collapsing those intel sections would delete real frozen-at-close context with a false
  // "folded into Trade manager read" note (SWING-SYSTEM-CTO-AUDIT finding #2).
  if (opts.bucket === "closed") return sections;

  const filtered = sections.filter((s) => {
    if (!NARRATIVE_COVERED_TITLES.has(s.title)) return true;
    // "Lane rank" is the one conditionally-covered title in the set — see the doc comment above.
    // Keep it (don't drop) unless the caller proves laneRankCoaching actually fired.
    if (s.title === "Lane rank") return opts.laneRankFolded !== true;
    return false;
  });

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
