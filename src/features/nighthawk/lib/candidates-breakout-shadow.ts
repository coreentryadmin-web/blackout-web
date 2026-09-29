// Confluence-gate STRUCTURE-exemption SHADOW LOG (2026-09-22, operator-directed cross-lane audit:
// "study what swings sees vs what you see... find more bangers").
//
// WHY: a live cross-check against a whole-market banger scan (top-29 movers by $-volume,
// scripts/audit/market-banger-scan.mjs, 2026-09-22 session) found 25/29 (86%) never entered
// Legacy's candidate pool at all — not rejected after being considered, never discovered. Traced
// into candidates.ts's own scoring: the whole-market "breakout" (STRUCTURE) lane is real
// (screenBreakoutMovers over Polygon grouped-daily, the SAME data source the standalone scanner
// uses, with looser thresholds) but caps at LANE_MAX_BREAKOUT=18 with no streak/unusualness
// multiplier, vs the flow lane's LANE_MAX_FLOW=28 PLUS compounding streak/unusualness multipliers
// that only apply to flow-matched tickers. So a pure price/volume breakout name almost never
// cracks applyConfluenceGate's unconditional top-CONFLUENCE_PROTECTED_TOP admission, and below
// that rank it needs CONFLUENCE_MIN_SOURCES (2) independent lanes to survive — which options flow
// (concentrated in liquid mega-caps by nature) structurally denies most small/mid-cap momentum
// names. Net effect: the breakout lane, despite its own doc comment describing it as "widening
// the funnel toward tradeable bangers," is scored too low to ever do that.
//
// Night Hawk Swings already solves exactly this problem — src/lib/swing/discovery.ts's own doc
// comment: "a STRUCTURE-only name with NO flow still passes through... never dropped merely
// because it has no options flow." This module mirrors that principle as a SHADOW-ONLY correction
// to Legacy's confluence gate — `computeCorrectedCandidatePool` is applyConfluenceGate, verbatim,
// plus ONE added admission path: a row whose sources include "breakout" is admitted
// unconditionally, the same structure-exemption guarantee Swing already ships. Zero change to the
// real candidates.ts pipeline — this only LOGS what the pool would look like corrected, for
// comparison, before any live-picks change is made.
import {
  applyConfluenceGate,
  CONFLUENCE_PROTECTED_TOP,
  CONFLUENCE_MIN_SOURCES,
  type MultiSourceCandidateRow,
  type DiscoveryStageSnapshotRow,
} from "./candidates";

/**
 * applyConfluenceGate, verbatim, plus ONE corrected admission path: a row whose sources include
 * "breakout" (Legacy's whole-market STRUCTURE lane) is admitted unconditionally, mirroring
 * Swing's discovery.ts "a STRUCTURE-only name with no flow still passes through" guarantee. A
 * drift-guard test source-inspects applyConfluenceGate to catch divergence if the real admission
 * logic ever changes shape.
 */
export function computeCorrectedCandidatePool(
  rows: MultiSourceCandidateRow[],
  maxTickers: number,
  protectedTop: number = CONFLUENCE_PROTECTED_TOP,
  minSources: number = CONFLUENCE_MIN_SOURCES
): MultiSourceCandidateRow[] {
  const admitted: MultiSourceCandidateRow[] = [];
  for (let i = 0; i < rows.length && admitted.length < maxTickers; i++) {
    const row = rows[i]!;
    const structureExempt = row.sources.includes("breakout");
    if (i < protectedTop || row.source_count >= minSources || structureExempt) admitted.push(row);
  }
  return admitted;
}

export type CandidatePoolComparison = {
  schema_version: 1;
  actual_pool_size: number;
  corrected_pool_size: number;
  would_differ: boolean;
  /** In the corrected pool but not the real one — structure-only names the exemption rescues. */
  newly_admitted_tickers: string[];
  /** In the real pool but not the corrected one — pushed out of the fixed maxTickers budget to
   *  make room for the newly-admitted structure-only names above. */
  dropped_to_make_room_tickers: string[];
};

/**
 * Compares the REAL production applyConfluenceGate output against the corrected structure-
 * exemption gate over the same pre-gate `rows` (must already be sorted by composite_score
 * descending, same contract as applyConfluenceGate itself). Calls the real, exported
 * applyConfluenceGate directly for the "actual" side, so it can never diverge from real
 * production output.
 */
export function compareCandidatePool(
  rows: MultiSourceCandidateRow[],
  maxTickers: number
): CandidatePoolComparison {
  const actual = applyConfluenceGate(rows, maxTickers);
  const corrected = computeCorrectedCandidatePool(rows, maxTickers);
  const actualSet = new Set(actual.map((r) => r.ticker));
  const correctedSet = new Set(corrected.map((r) => r.ticker));
  const newlyAdmitted = corrected.filter((r) => !actualSet.has(r.ticker)).map((r) => r.ticker);
  const dropped = actual.filter((r) => !correctedSet.has(r.ticker)).map((r) => r.ticker);
  return {
    schema_version: 1,
    actual_pool_size: actual.length,
    corrected_pool_size: corrected.length,
    would_differ: newlyAdmitted.length > 0 || dropped.length > 0,
    newly_admitted_tickers: newlyAdmitted,
    dropped_to_make_room_tickers: dropped,
  };
}

/**
 * ONE sentinel row per edition build (not per-ticker — this is a single build-level pool
 * comparison, not a per-ticker feature), matching the bearish-posture-shadow capture convention.
 * ticker="__EDITION__" so it never collides with a real ticker; stage
 * "breakout_confluence_shadow" is a new free-text stage tag (nighthawk_candidate_snapshot.stage
 * has no CHECK constraint, so no migration is needed) and is NOT in
 * fetchNighthawkCandidateSnapshotsInRange's default stage scope (["rank_final","rejected"]), so
 * it can never pollute any existing reader.
 */
export function buildBreakoutConfluenceShadowSnapshotRow(
  editionFor: string,
  comparison: CandidatePoolComparison
): DiscoveryStageSnapshotRow {
  return {
    edition_for: editionFor,
    ticker: "__EDITION__",
    stage: "breakout_confluence_shadow",
    rank: null,
    score: null,
    gov_penalty: null,
    rejection_reason: null,
    selected_for_publish: null,
    snapshot_json: { ...comparison },
  };
}
