/**
 * AMPLIFY / short-gamma session commit relief — widens the plan spread cap, nudges
 * near-miss scores over G-3, and bypasses thesis-first blocks for proven FLOW tape.
 * Mirrors chase-exempt.ts carve-outs; kill-switches per relief lane.
 */
import type { PlanChaseContext } from "./chase-exempt";
import { isAmplifyMomentumRegime } from "./chase-exempt";
import { PLAN_ILLIQUID_SPREAD_PCT } from "./plan";

function envInt(name: string, def: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : def;
}

function flowBacked(origins: readonly string[] | null | undefined): boolean {
  const set = Array.isArray(origins) ? origins : [];
  return set.length === 0 || set.includes("FLOW");
}

function tapeBacked(origins: readonly string[] | null | undefined): boolean {
  const set = Array.isArray(origins) ? origins : [];
  return set.includes("FLOW") || set.includes("BREAKOUT");
}

/** Amplify-session aligned tape (FLOW or BREAKOUT) — relax archetype score floors. */
export function regimeThesisArchetypeRelief(ctx: PlanChaseContext): boolean {
  if (process.env.ZERODTE_AMPLIFY_THESIS_ARCHETYPE_RELIEF === "0") return false;
  if (!isAmplifyMomentumRegime(ctx)) return false;
  if (!tapeBacked(ctx.discovery_origin)) return false;
  if (ctx.market_aligned !== true) return false;
  const min = envInt("ZERODTE_AMPLIFY_THESIS_ARCHETYPE_MIN_SCORE", 75);
  if (ctx.score < min) return false;
  return true;
}

/** Default G-9 spread cap (% of mark). Amplify sessions may widen via effectiveIlliquidSpreadPct. */
export const PLAN_ILLIQUID_SPREAD_PCT_AMPLIFY = envInt("ZERODTE_PLAN_ILLIQUID_SPREAD_PCT_AMPLIFY", 22);

/** Spread cap for plan build + G-9 — 15% baseline, 22% on amplify/trend (env-tunable). */
export function effectiveIlliquidSpreadPct(ctx?: PlanChaseContext | null): number {
  if (process.env.ZERODTE_AMPLIFY_ILLIQUID_RELIEF === "0") return PLAN_ILLIQUID_SPREAD_PCT;
  if (!ctx || !isAmplifyMomentumRegime(ctx)) return PLAN_ILLIQUID_SPREAD_PCT;
  return PLAN_ILLIQUID_SPREAD_PCT_AMPLIFY;
}

/** Near-miss G-3 bump on amplify days — only when post-edge score is just under 65. */
export const REGIME_SCORE_BUMP = envInt("ZERODTE_REGIME_SCORE_BUMP", 6);

const REGIME_SCORE_BUMP_MIN = 58;
const REGIME_SCORE_FLOOR = 65;

export function regimeScoreBump(ctx: PlanChaseContext): number {
  if (process.env.ZERODTE_AMPLIFY_SCORE_BUMP === "0") return 0;
  if (!isAmplifyMomentumRegime(ctx)) return 0;
  if (!tapeBacked(ctx.discovery_origin)) return 0;
  if (ctx.market_aligned !== true) return 0;
  if (ctx.score < REGIME_SCORE_BUMP_MIN || ctx.score >= REGIME_SCORE_FLOOR) return 0;
  return REGIME_SCORE_BUMP;
}

const THESIS_BYPASS_MIN_SCORE = envInt("ZERODTE_AMPLIFY_THESIS_BYPASS_MIN_SCORE", 80);

/** High-conviction aligned FLOW/BREAKOUT on amplify days — skip thesis-first pre-gate blocks. */
export function regimeBypassesThesisBlocks(ctx: PlanChaseContext): boolean {
  if (process.env.ZERODTE_AMPLIFY_THESIS_BYPASS === "0") return false;
  if (!isAmplifyMomentumRegime(ctx)) return false;
  if (!tapeBacked(ctx.discovery_origin)) return false;
  if (ctx.market_aligned !== true) return false;
  if (ctx.score < THESIS_BYPASS_MIN_SCORE) return false;
  return true;
}

/** Build PlanChaseContext from a setup row at gate/plan time. */
export function planChaseContextFromSetup(s: {
  direction: "long" | "short";
  score: number;
  discovery_origin?: readonly string[] | null;
  gamma_regime?: string | null;
  market_aligned?: boolean | null;
  regime_structure?: string | null;
  market_state_confidence?: number | null;
  vector_pulse?: PlanChaseContext["vector_pulse"];
}): PlanChaseContext {
  return {
    direction: s.direction,
    score: s.score,
    discovery_origin: s.discovery_origin,
    gamma_regime: s.gamma_regime ?? null,
    market_aligned: s.market_aligned ?? null,
    regime_structure: s.regime_structure ?? null,
    market_state_confidence: s.market_state_confidence ?? null,
    vector_pulse: s.vector_pulse ?? null,
  };
}
