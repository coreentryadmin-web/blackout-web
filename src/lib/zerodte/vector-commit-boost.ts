/**
 * Vector ↔ 0DTE commit boost — when Vector's live desk is already printing a winner/runner
 * in the SAME direction, relax selective gates and nudge score so Night Hawk can commit the
 * name Vector is proving out (calibration near-misses → action).
 */
import type { ZeroDteVectorPulse } from "./vector-crosslink";
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
      g17_exempt: score >= 70,
      confluence_credit: 0,
      reason: `Vector runner building (+${Math.round(pulse!.premium_pct ?? 0)}%) aligns with ${direction}`,
    };
  }
  return { score_bump: 0, g17_exempt: false, confluence_credit: 0, reason: null };
}

/** G-17 exemption predicate — exported for gates.ts. */
export function vectorExemptsG17PrimeBand(
  direction: "long" | "short",
  score: number,
  pulse: ZeroDteVectorPulse | null | undefined
): boolean {
  return computeVectorGateBoost(direction, score, pulse).g17_exempt;
}

/** Score floor for G-17 when not exempted (unchanged constant re-export for tests). */
export { ZERODTE_SINGLE_RAIL_PRIME_MIN };
