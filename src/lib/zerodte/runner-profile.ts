/**
 * Night Hawk 0DTE runner profile — widens the profit runway for the desk's best setups
 * (A-tier + strong confluence, Vector-confirmed momentum) toward Vector-style 100–500% winners.
 *
 * Default plan rails stay −50% / +100% (PLAN_RULES). Runner profile raises ONLY the frozen
 * per-play target on commit (exit_policy_snapshot.target_pct) so historical rows stay honest.
 */
import type { ZeroDteRegime } from "./exit-engine";
import { PLAN_RULES } from "./plan";
import type { ZeroDteVectorPulse } from "./vector-crosslink";
import { vectorPulseAlignsDirection } from "./vector-commit-boost";

/** Standard runner target for A-tier + double confluence (3× premium). */
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
  tag: "standard" | "runner_a" | "runner_vector" | "runner_b_vector" | "runner_b_runner";
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
  if (input.tier === "A" && input.confluenceCount >= 2) {
    return { target_pct: RUNNER_TARGET_PCT_A, regime: "trend", tag: "runner_a" };
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
