/**
 * Night Hawk 0DTE runner profile — widens the profit runway for the desk's best setups
 * (A/B-tier + Vector-confirmed winner/runner momentum) toward Vector-style 100–500% winners.
 *
 * Default plan rails stay −50% / +100% (PLAN_RULES). Runner profile raises ONLY the frozen
 * per-play target on commit (exit_policy_snapshot.target_pct) so historical rows stay honest.
 */
import type { ZeroDteRegime } from "./exit-engine";
import { scoreFloorForOrigins } from "./gates";
import { PLAN_RULES } from "./plan";
import { assignZeroDteTier } from "./tiers";
import type { ZeroDteVectorPulse } from "./vector-crosslink-core";
import { computeVectorGateBoost, vectorPulseAlignsDirection } from "./vector-commit-boost";
import { RUNNER_SETUP_MAX_OTM_PCT, SETUP_MAX_OTM_PCT } from "./board";

/** A-tier Vector-runner-confirmed target (3× premium). */
export const RUNNER_TARGET_PCT_A = (() => {
  const raw = process.env.ZERODTE_RUNNER_TARGET_A?.trim();
  const n = raw ? Number(raw) : 300;
  return Number.isFinite(n) && n > PLAN_RULES.target_pct ? n : 300;
})();

/** Vector-winner-confirmed runner target (4× premium). */
export const RUNNER_TARGET_PCT_VECTOR = (() => {
  const raw = process.env.ZERODTE_RUNNER_TARGET_VECTOR?.trim();
  const n = raw ? Number(raw) : 400;
  return Number.isFinite(n) && n > PLAN_RULES.target_pct ? n : 400;
})();

/** B-tier Vector winner gets a lighter extension (2.5×). */
export const RUNNER_TARGET_PCT_B_VECTOR = (() => {
  const raw = process.env.ZERODTE_RUNNER_TARGET_B_VECTOR?.trim();
  const n = raw ? Number(raw) : 250;
  return Number.isFinite(n) && n > PLAN_RULES.target_pct ? n : 250;
})();

/** B-tier Vector runner building band (2×). */
export const RUNNER_TARGET_PCT_B_RUNNER = (() => {
  const raw = process.env.ZERODTE_RUNNER_TARGET_B_RUNNER?.trim();
  const n = raw ? Number(raw) : 200;
  return Number.isFinite(n) && n > PLAN_RULES.target_pct ? n : 200;
})();

export type RunnerProfile = {
  /** Profit target % of entry premium frozen at commit. */
  target_pct: number;
  /** Trim-scale regime — trend lets the runner breathe (later trims). */
  regime: ZeroDteRegime;
  /** Human tag for telemetry / entry_context. */
  tag: "standard" | "runner_a" | "runner_vector" | "runner_b_vector" | "runner_b_runner" | "runner_b_baseline";
};

export type RunnerProfileInput = {
  tier: "A" | "B" | "C" | null | undefined;
  confluenceCount: number;
  vectorPulse: ZeroDteVectorPulse | null | undefined;
  direction: "long" | "short";
};

/**
 * Resolve an extended runner target for this play, or null → use PLAN_RULES.target_pct (+100%).
 * Pure — no IO.
 */
export function resolveRunnerProfile(input: RunnerProfileInput): RunnerProfile | null {
  const aligned = vectorPulseAlignsDirection(input.direction, input.vectorPulse);
  const vectorWinner = aligned && input.vectorPulse?.is_winner === true;
  const vectorRunner = aligned && input.vectorPulse?.is_runner === true;

  if (input.tier === "A" && vectorWinner) {
    return { target_pct: RUNNER_TARGET_PCT_VECTOR, regime: "trend", tag: "runner_vector" };
  }
  if (input.tier === "B" && vectorWinner) {
    return { target_pct: RUNNER_TARGET_PCT_B_VECTOR, regime: "trend", tag: "runner_b_vector" };
  }
  if (input.tier === "B" && vectorRunner && input.confluenceCount >= 1) {
    return { target_pct: RUNNER_TARGET_PCT_B_RUNNER, regime: "trend", tag: "runner_b_runner" };
  }
  if (input.tier === "A" && vectorRunner && input.confluenceCount >= 1) {
    return { target_pct: RUNNER_TARGET_PCT_A, regime: "trend", tag: "runner_a" };
  }
  return null;
}

export type RunnerProfileCandidateInput = {
  score: number | null;
  direction: "long" | "short";
  /** VWAP-side + market confirmations (before Vector credit). */
  confluenceCount: number;
  vectorPulse: ZeroDteVectorPulse | null | undefined;
  /** Frozen tier when committed; omitted on WATCH — estimated from score + Cortex. */
  tier?: "A" | "B" | "C" | null;
  cortexScore?: number | null;
  cortexVetoCount?: number | null;
  cortexSupportCount?: number | null;
  cortexAbsentCount?: number | null;
  discoveryOrigin?: string[] | null;
};

/**
 * Project the runner target a candidate WOULD receive on commit — used for WATCH/SKIP cards
 * before entry_context pins runner_profile. Mirrors persistZeroDteScan's tier + Vector boost path.
 */
export function projectRunnerProfileForCandidate(input: RunnerProfileCandidateInput): RunnerProfile | null {
  const score = input.score != null && Number.isFinite(input.score) ? input.score : null;
  let tier = input.tier ?? null;
  if (!tier && score != null) {
    const assigned = assignZeroDteTier({
      score,
      scoreFloor: scoreFloorForOrigins(input.discoveryOrigin),
      cortexScore: input.cortexScore ?? null,
      cortexVetoCount: input.cortexVetoCount ?? null,
      cortexSupportCount: input.cortexSupportCount ?? null,
      cortexAbsentCount: input.cortexAbsentCount ?? null,
      vixOpen: null,
      committedEtMinutes: null,
    });
    tier = assigned.tier;
  }
  const boost = computeVectorGateBoost(input.direction, score ?? 0, input.vectorPulse);
  const confluenceCount = input.confluenceCount + (boost.confluence_credit ?? 0);
  return resolveRunnerProfile({
    tier,
    confluenceCount,
    vectorPulse: input.vectorPulse,
    direction: input.direction,
  });
}

/** Whether this setup qualifies for the relaxed runner OTM cap at gate time. */
export function vectorRunnerOtmRelax(
  direction: "long" | "short",
  score: number,
  pulse: ZeroDteVectorPulse | null | undefined
): boolean {
  if (!vectorPulseAlignsDirection(direction, pulse)) return false;
  if (pulse?.is_winner) return true;
  return pulse?.is_runner === true && score >= 68;
}

/** Effective max OTM % for moneyness gate — runner relax or standard cap. */
export function effectiveMaxOtmPct(runnerRelaxed: boolean): number {
  return runnerRelaxed ? RUNNER_SETUP_MAX_OTM_PCT : SETUP_MAX_OTM_PCT;
}
