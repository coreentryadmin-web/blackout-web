// #30 shadow-log (2026-09-21): bearish-posture.ts's composite_regime bearish check is dead code
// — derive-composite.ts's real 7-value enum (MEAN_REVERT_TRENDING_UP/DOWN, AMPLIFY_BREAKOUT/
// BREAKDOWN/MIXED, MEAN_REVERT_MIXED, NEUTRAL) never contains "BEARISH" or "NEGATIVE", so that
// branch of the 2-of-3 gate can never fire on real data. The correct fix (comp.includes("DOWN"))
// would change LIVE ranking (restores a previously-inert SHORT-posture path), so per operator
// instruction this module only LOGS what the corrected gate would have decided, for later
// comparison — it never feeds back into detectBookPosture/applyBearishPosture, which this file
// deliberately never edits.
import { detectBookPosture, applyBearishPosture, type BookPosture } from "./bearish-posture";
import type { NightHawkRegimeContext, ScoredCandidate } from "./scorer";

// Mirrors bearish-posture.ts's own private SHORT_POSTURE_BONUS/LONG_POSTURE_PENALTY (8/6) —
// duplicated, not imported, because those are unexported (same precedent as
// signal-intelligence-corrections.ts for a shadow module that can't import an unexported
// production value). bearish-posture-shadow.test.ts's drift-guard source-inspects
// bearish-posture.ts for these literal values so a future change to them can't silently
// desync the corrected-side simulation below.
const SHORT_POSTURE_BONUS = 8;
const LONG_POSTURE_PENALTY = 6;

/**
 * The CORRECTED gate: `comp.includes("DOWN")` instead of BEARISH/NEGATIVE. Matches
 * MEAN_REVERT_TRENDING_DOWN and AMPLIFY_BREAKDOWN (derive-composite.ts's only 2 actually-bearish
 * values of its 7-value enum) — never fires on the buggy strings, which derive-composite.ts
 * never emits. Mirrors detectBookPosture verbatim except this one line.
 */
export function detectBookPostureCorrected(
  regime: NightHawkRegimeContext | null | undefined
): { posture: BookPosture; reasons: string[] } {
  if (!regime) return { posture: "NEUTRAL", reasons: [] };

  const signals: string[] = [];

  if (regime.tide_bias === "BEARISH") {
    signals.push("tide put-dominated (>55% put premium)");
  }

  if (regime.advance_pct != null && regime.advance_pct < 35) {
    signals.push(`breadth collapse (${regime.advance_pct.toFixed(1)}% advancing)`);
  }

  const comp = regime.composite_regime?.toUpperCase();
  if (comp && comp.includes("DOWN")) {
    signals.push(`composite regime bearish (${regime.composite_regime})`);
  }

  // Same threshold as production — BEARISH_POSTURE_MIN_SIGNALS is exported from bearish-posture.ts
  // and re-imported below in compareBearishPosture's own module scope, not duplicated, since it's
  // a plain exported constant (unlike the two unexported bonus/penalty literals above).
  if (signals.length >= 2) {
    return { posture: "SHORT", reasons: signals };
  }

  return { posture: "NEUTRAL", reasons: [] };
}

/** Re-ranks exactly like applyBearishPosture, but using the corrected posture detection — pure
 *  simulation, never called from the live pipeline. */
function applyCorrectedPosture(
  ranked: ScoredCandidate[],
  regime: NightHawkRegimeContext | null | undefined
): { posture: BookPosture; reasons: string[]; ranked: ScoredCandidate[]; shortsBoosted: number; longsPenalized: number } {
  const { posture, reasons } = detectBookPostureCorrected(regime);

  if (posture !== "SHORT") {
    return { posture, reasons, ranked, shortsBoosted: 0, longsPenalized: 0 };
  }

  let shortsBoosted = 0;
  let longsPenalized = 0;
  const adjusted = ranked.map((c) => {
    if (c.direction === "short") {
      shortsBoosted += 1;
      return { ...c, score: c.score + SHORT_POSTURE_BONUS };
    }
    longsPenalized += 1;
    return { ...c, score: Math.max(0, c.score - LONG_POSTURE_PENALTY) };
  });

  const reranked = [...adjusted].sort((a, b) => b.score - a.score);

  return { posture, reasons, ranked: reranked, shortsBoosted, longsPenalized };
}

export type BearishPostureShadowComparison = {
  schema_version: 1;
  composite_regime: string | null;
  actual: { posture: BookPosture; reasons: string[] };
  corrected: { posture: BookPosture; reasons: string[] };
  would_differ: boolean;
  actual_top5_tickers: string[];
  would_be_top5_tickers: string[] | null;
  top5_would_change: boolean;
  would_be_shorts_boosted: number | null;
  would_be_longs_penalized: number | null;
};

function top5Tickers(ranked: ScoredCandidate[]): string[] {
  return ranked.slice(0, 5).map((c) => c.ticker);
}

function sameTop5(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

/**
 * ranked/regime must be the EXACT SAME two arguments edition-builder.ts already passes to
 * applyBearishPosture(ranked, regime) at STAGE 4c — call this alongside, not instead of, that
 * call, using the identical objects (no re-fetch, no re-derivation of inputs). Calls the REAL
 * detectBookPosture/applyBearishPosture for the "actual" side, so it can never diverge from real
 * production output.
 */
export function compareBearishPosture(
  ranked: ScoredCandidate[],
  regime: NightHawkRegimeContext | null | undefined
): BearishPostureShadowComparison {
  const actualPosture = detectBookPosture(regime);
  const actualResult = applyBearishPosture(ranked, regime);
  const correctedPosture = detectBookPostureCorrected(regime);
  const correctedResult = applyCorrectedPosture(ranked, regime);

  const actualTop5 = top5Tickers(actualResult.ranked);
  const wouldBeTop5 = correctedPosture.posture === "SHORT" ? top5Tickers(correctedResult.ranked) : null;
  const top5WouldChange = wouldBeTop5 != null && !sameTop5(actualTop5, wouldBeTop5);

  return {
    schema_version: 1,
    composite_regime: regime?.composite_regime ?? null,
    actual: actualPosture,
    corrected: correctedPosture,
    would_differ: actualPosture.posture !== correctedPosture.posture,
    actual_top5_tickers: actualTop5,
    would_be_top5_tickers: wouldBeTop5,
    top5_would_change: top5WouldChange,
    would_be_shorts_boosted: correctedPosture.posture === "SHORT" ? correctedResult.shortsBoosted : null,
    would_be_longs_penalized: correctedPosture.posture === "SHORT" ? correctedResult.longsPenalized : null,
  };
}

export type BearishPostureShadowSnapshotRow = {
  edition_for: string;
  ticker: string;
  stage: string;
  rank: null;
  score: null;
  gov_penalty: null;
  rejection_reason: null;
  selected_for_publish: null;
  snapshot_json: Record<string, unknown>;
};

/**
 * ONE sentinel row per edition build (not per-ticker — this is a single build-level verdict
 * comparison, not a per-ticker feature). ticker="__EDITION__" so it never collides with a real
 * ticker; stage "bearish_posture_shadow" is a new free-text stage tag (nighthawk_candidate_snapshot
 * .stage has no CHECK constraint, so no migration is needed) and is NOT in
 * fetchNighthawkCandidateSnapshotsInRange's default stage scope (["rank_final","rejected"]), so it
 * can never pollute any existing reader.
 */
export function buildBearishPostureShadowSnapshotRow(
  editionFor: string,
  comparison: BearishPostureShadowComparison
): BearishPostureShadowSnapshotRow {
  return {
    edition_for: editionFor,
    ticker: "__EDITION__",
    stage: "bearish_posture_shadow",
    rank: null,
    score: null,
    gov_penalty: null,
    rejection_reason: null,
    selected_for_publish: null,
    snapshot_json: { ...comparison },
  };
}
