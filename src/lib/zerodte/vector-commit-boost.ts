/**
 * Vector ↔ 0DTE commit boost — when Vector's live desk is already printing a winner/runner
 * in the SAME direction, relax selective gates and nudge score so Night Hawk can commit the
 * name Vector is proving out (calibration near-misses → action).
 */
import type { ZeroDteVectorPulse } from "./vector-crosslink-core";
import { ZERODTE_SINGLE_RAIL_PRIME_MIN } from "./gates";

export const VECTOR_SCORE_BUMP_WINNER = 8;
export const VECTOR_SCORE_BUMP_RUNNER = 4;

/** Vector pick side → desk direction. */
export function vectorSideToDirection(side: string | null | undefined): "long" | "short" | null {
  const s = (side ?? "").toLowerCase();
  if (s === "call") return "long";
  if (s === "put") return "short";
  return null;
}

export function vectorPulseAlignsDirection(
  setupDirection: "long" | "short",
  pulse: ZeroDteVectorPulse | null | undefined
): boolean {
  if (!pulse?.direction) return false;
  return pulse.direction === setupDirection;
}

export type VectorGateBoost = {
  /** Additive score nudge (capped by caller). */
  score_bump: number;
  /** Skip G-17 prime-band block when true. */
  g17_exempt: boolean;
  /** Extra confluence credit (0 or 1). */
  confluence_credit: number;
  reason: string | null;
};

/**
 * Compute gate/score boosts from Vector pulse alignment. Pure.
 */
export function computeVectorGateBoost(
  direction: "long" | "short",
  score: number,
  pulse: ZeroDteVectorPulse | null | undefined
): VectorGateBoost {
  if (!vectorPulseAlignsDirection(direction, pulse)) {
    return { score_bump: 0, g17_exempt: false, confluence_credit: 0, reason: null };
  }
  if (pulse!.is_winner) {
    return {
      score_bump: VECTOR_SCORE_BUMP_WINNER,
      g17_exempt: true,
      confluence_credit: 1,
      reason: `Vector winner (+${Math.round(pulse!.peak_premium_pct ?? pulse!.premium_pct ?? 0)}%) aligns with ${direction}`,
    };
  }
  if (pulse!.is_runner && score >= 68) {
    return {
      score_bump: VECTOR_SCORE_BUMP_RUNNER,
      g17_exempt: true,
      confluence_credit: 0,
      reason: `Vector runner building (+${Math.round(pulse!.premium_pct ?? 0)}%) aligns with ${direction}`,
    };
  }
  return { score_bump: 0, g17_exempt: false, confluence_credit: 0, reason: null };
}

const NO_VECTOR_BOOST: VectorGateBoost = { score_bump: 0, g17_exempt: false, confluence_credit: 0, reason: null };

/**
 * CONDOR BYPASS (added 2026-09-17): a CONDOR's `direction` is nominal fade provenance only —
 * "the condor is delta-neutral" (condor.ts). computeVectorGateBoost's whole model is "Vector's
 * directional pulse agrees with this setup's direction", which is meaningless for a delta-neutral
 * structure: Vector prints a LONG/SHORT read, and a condor was never betting on that direction in
 * the first place, so "alignment" is coincidence, not corroboration. Feeding it through anyway
 * would (a) inflate the score fed to G-3/G-18 (neither is condor-exempt, unlike G-17) on
 * meaningless grounds, and (b) grant a chase/prime-band exemption a condor structurally cannot
 * use. Same root-cause family as cortexAbstainForCondor() (cortex-gate.ts) — that fix, this one,
 * and four earlier ones (Largo's cross-product read, the governor, Thesis Health, live
 * confluence) are all the identical "condor's nominal direction misread as real directional
 * evidence" defect at a different surface. Wraps computeVectorGateBoost rather than requiring
 * every call site to remember the play_type check inline.
 */
export function computeVectorGateBoostForPlayType(
  playType: string | null | undefined,
  direction: "long" | "short",
  score: number,
  pulse: ZeroDteVectorPulse | null | undefined
): VectorGateBoost {
  if (playType === "CONDOR") return NO_VECTOR_BOOST;
  return computeVectorGateBoost(direction, score, pulse);
}

/** G-17 exemption predicate — exported for gates.ts. */
export function vectorExemptsG17PrimeBand(
  direction: "long" | "short",
  score: number,
  pulse: ZeroDteVectorPulse | null | undefined
): boolean {
  return computeVectorGateBoost(direction, score, pulse).g17_exempt;
}

/** G-19 exemption — same predicate as G-17: aligned Vector winner OR runner at score ≥ 68. */
export function vectorExemptsG19TopBand(
  direction: "long" | "short",
  score: number,
  pulse: ZeroDteVectorPulse | null | undefined
): boolean {
  return vectorExemptsG17PrimeBand(direction, score, pulse);
}

/**
 * G-8 chase exemption — when Vector is already printing a winner/runner in the SAME direction,
 * the premium has often run past the stale UW flow fill by the time quotes attach. Blocking as
 * "don't chase" on those names empties OPEN on amplification days while the board still shows
 * huge hypothetical trackPct. Exempt → commit at the live mark (resolveLedgerEntryPremium floors
 * the ledger basis there) instead of SKIP/PASSED.
 */
export function vectorExemptsPlanChase(
  direction: "long" | "short",
  score: number,
  pulse: ZeroDteVectorPulse | null | undefined
): boolean {
  if (process.env.ZERODTE_VECTOR_CHASE_EXEMPT === "0") return false;
  return vectorExemptsG17PrimeBand(direction, score, pulse);
}

/** Score floor for G-17 when not exempted (unchanged constant re-export for tests). */
export { ZERODTE_SINGLE_RAIL_PRIME_MIN };
