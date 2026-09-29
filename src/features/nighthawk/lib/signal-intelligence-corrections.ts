/**
 * Pure correction functions for Night Hawk Legacy's Signal Intelligence measurement project
 * (docs/audit/NIGHTHAWK-LEGACY-SIGNAL-INTELLIGENCE.md, Phase 1 foundation / Phase 3 prep).
 *
 * These do NOT touch production ranking/scoring behavior — nothing here is imported by
 * candidates.ts, scorer.ts, edition-builder.ts, cross-edition-governor.ts, or
 * deterministic-edition.ts, and none of those files are modified by this module's existence.
 * Per explicit operator instruction, the two confirmed bugs below stay live in production until
 * their actual impact is proven from real shadow-vs-production data (Phase 2/3), not fixed here.
 *
 * What this module IS for: testable, pure implementations of what the CORRECT computation would
 * be, so Phase 3's shadow_bugfix variant can apply them to real historical
 * nighthawk_candidate_snapshot rows (once Phase 1.3-1.5 wire the raw inputs these functions need
 * into that table) without re-deriving the fix logic ad hoc at analysis time, and without ever
 * touching the production functions these mirror.
 */

// ───────────────────────────────────────────────────────────────────────────
// Bug 1: the unusualness-multiplier unit mismatch (candidates.ts:680-688)
// ───────────────────────────────────────────────────────────────────────────
//
// Production's extractMultiSourceCandidates divides laneFlow()'s NORMALIZED 0-28 lane-point
// return value by a REAL-DOLLAR baseline (avgPremiums[ticker], floored at
// CANDIDATE_MIN_BASELINE_PREMIUM), then clamps that lane-points-over-dollars ratio to [0.5, 3].
// Since a lane-point value (0-28) divided by a real dollar figure (typically five-to-seven
// digits) is always near zero, the multiplier floors to 0.5x for virtually every flow-touched
// candidate — the opposite of "reward unusual flow." The correct comparison (used by the older,
// unused extractCandidateTickers path) is real dollars over real dollars: raw flow premium
// (laneFlow()'s own internal, currently-discarded `seen` map) divided by the same baseline.

/** Mirrors candidates.ts's own private unusualnessMultiplier(ratio) exactly (clamp to [0.5, 3]) —
 *  duplicated rather than imported since that function is unexported and this module
 *  deliberately never imports from candidates.ts (see module doc: zero production coupling). */
function clampUnusualnessRatio(ratio: number): number {
  return Math.max(0.5, Math.min(3, ratio));
}

/**
 * What production ACTUALLY computes today (the bug), reproduced here only so a shadow-vs-
 * production comparison can show both numbers side by side without re-deriving the bug from
 * scratch at analysis time. Never call this expecting a meaningful signal — it's the buggy value.
 */
export function productionUnusualnessMultiplier(
  normalizedLanePoints: number,
  baselineDollars: number
): number {
  if (baselineDollars <= 0) return clampUnusualnessRatio(0);
  return clampUnusualnessRatio(normalizedLanePoints / baselineDollars);
}

/**
 * The CORRECTED ratio: real raw flow-premium dollars over the real dollar baseline — the same
 * comparison extractCandidateTickers' (unused legacy path) agg.rawPremium / baseline already
 * does correctly. Returns 0 (not a clamped multiplier) when there's no real baseline to compare
 * against, matching the honest-absence discipline the rest of this codebase uses elsewhere.
 */
export function correctedUnusualnessRatio(rawFlowPremiumDollars: number, baselineDollars: number): number {
  if (baselineDollars <= 0) return 0;
  return rawFlowPremiumDollars / baselineDollars;
}

/** The corrected multiplier: the same [0.5, 3] clamp production already applies, over the
 *  CORRECT real-dollar ratio instead of the buggy lane-points-over-dollars one. */
export function correctedUnusualnessMultiplier(rawFlowPremiumDollars: number, baselineDollars: number): number {
  return clampUnusualnessRatio(correctedUnusualnessRatio(rawFlowPremiumDollars, baselineDollars));
}

// ───────────────────────────────────────────────────────────────────────────
// Bug 2: the governor-blind final sort ("PR-N26", edition-builder.ts:1144-1149)
// ───────────────────────────────────────────────────────────────────────────
//
// deterministic-edition.ts:897-906 correctly merges/sorts by EFFECTIVE score
// (score - (govPenalty ?? 0)), so a candidate the cross-edition governor demoted for a
// repeat-ticker cooldown, loss-streak halt, or sector-concentration cap sorts lower there. But
// edition-builder.ts's LAST sort pass — the one whose order members actually see — re-sorts by
// RAW score only, silently undoing that ordering. It doesn't undo the governor's earlier CUTS
// (those candidates are already gone by then); it only re-scrambles the ORDER of whichever
// penalized survivors made it through, so a governor-demoted candidate can land back at rank #1.

export type EffectiveScoreCandidate = {
  ticker: string;
  score: number | null | undefined;
  govPenalty?: number | null;
};

/** Mirrors deterministic-edition.ts:901's own effective-score formula exactly:
 *  score - (govPenalty ?? 0). Null/undefined score reads as -Infinity, matching
 *  edition-builder.ts's existing (b.score ?? -Infinity) null-safety on the raw-score sort, so a
 *  candidate with a missing score always sorts last under either the buggy or corrected order. */
export function effectiveScore(candidate: Pick<EffectiveScoreCandidate, "score" | "govPenalty">): number {
  const raw = candidate.score ?? -Infinity;
  if (raw === -Infinity) return raw;
  return raw - (candidate.govPenalty ?? 0);
}

/**
 * What production's PR-N26 final sort ACTUALLY does today (the bug): re-sort by raw score,
 * ignoring govPenalty entirely. Reproduced here only for shadow-vs-production comparison, same
 * as productionUnusualnessMultiplier above — this is the buggy ordering, not a recommendation.
 * Returns a NEW array (never mutates the input), with 1-based rank stamped per the sorted order,
 * mirroring edition-builder.ts:1147-1148's own `.sort()` + `.forEach((p,i) => p.rank = i+1)` pair.
 */
export function productionFinalSort<T extends EffectiveScoreCandidate>(
  candidates: T[]
): Array<T & { rank: number }> {
  const sorted = [...candidates].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  return sorted.map((c, i) => ({ ...c, rank: i + 1 }));
}

/**
 * The CORRECTED final sort: by effective score (score - govPenalty) descending, so a
 * governor-demoted candidate stays demoted all the way through to the order members would see,
 * instead of being silently re-promoted by the last sort pass. Same non-mutating, 1-based-rank
 * contract as productionFinalSort above, so the two can be diffed directly on the same input.
 */
export function correctedFinalSort<T extends EffectiveScoreCandidate>(
  candidates: T[]
): Array<T & { rank: number }> {
  const sorted = [...candidates].sort((a, b) => effectiveScore(b) - effectiveScore(a));
  return sorted.map((c, i) => ({ ...c, rank: i + 1 }));
}
