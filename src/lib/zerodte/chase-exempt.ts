/**
 * G-8 chase + G-19 top-band relief on momentum / amplification sessions.
 * Vector-aligned winners were the first carve-out; this module adds regime-aware
 * widen for FLOW 85+ when the tape is amplifying and direction-aligned.
 */
import type { ZeroDteVectorPulse } from "./vector-crosslink";
import { vectorExemptsPlanChase, vectorExemptsG19TopBand } from "./vector-commit-boost";
import { CHASE_PCT } from "./plan";

export type PlanChaseContext = {
  direction: "long" | "short";
  score: number;
  vector_pulse?: ZeroDteVectorPulse | null;
  discovery_origin?: readonly string[] | null;
  gamma_regime?: string | null;
  market_aligned?: boolean | null;
  /** Market State Engine structure (TREND_UP / TREND_DOWN / RANGE …). */
  regime_structure?: string | null;
  market_state_confidence?: number;
};

const CHASE_PCT_AMPLIFY_DEFAULT = 75;

function flowBacked(origins: readonly string[] | null | undefined): boolean {
  const set = Array.isArray(origins) ? origins : [];
  return set.length === 0 || set.includes("FLOW");
}

/** Short-gamma / trend amplification — dealers amplify moves. */
export function isAmplifyMomentumRegime(ctx: PlanChaseContext): boolean {
  const gr = String(ctx.gamma_regime ?? "").toLowerCase();
  if (gr.includes("short_gamma") || gr.includes("amplification") || gr.includes("negative")) {
    return true;
  }
  const rs = ctx.regime_structure;
  if (rs === "TREND_UP" || rs === "TREND_DOWN") {
    return (ctx.market_state_confidence ?? 0) >= 0.7;
  }
  return false;
}

/** Higher chase band on amplify days — fewer false MOVED before commit. */
export function effectiveChasePct(ctx?: PlanChaseContext | null): number {
  const base = CHASE_PCT;
  if (process.env.ZERODTE_AMPLIFY_CHASE_EXEMPT === "0") return base;
  if (!ctx || !isAmplifyMomentumRegime(ctx)) return base;
  const raw = process.env.ZERODTE_CHASE_PCT_AMPLIFY?.trim();
  const amp = raw ? Number(raw) : CHASE_PCT_AMPLIFY_DEFAULT;
  return Number.isFinite(amp) && amp > base ? amp : base;
}

/** Regime carve-out: aligned FLOW 85+ on amplify/trend days (no Vector badge required). */
export function regimeExemptsPlanChase(ctx: PlanChaseContext): boolean {
  if (process.env.ZERODTE_AMPLIFY_CHASE_EXEMPT === "0") return false;
  if (!isAmplifyMomentumRegime(ctx)) return false;
  if (!flowBacked(ctx.discovery_origin)) return false;
  if (ctx.score < 85) return false;
  if (ctx.market_aligned !== true) return false;
  return true;
}

/** G-19 relief mirror — same predicate as regime chase on amplify days. */
export function regimeExemptsG19TopBand(ctx: PlanChaseContext): boolean {
  if (process.env.ZERODTE_REGIME_G19_EXEMPT === "0") return false;
  return regimeExemptsPlanChase(ctx);
}

/** Combined G-8 chase exemption — Vector OR regime momentum. */
export function planChaseExempt(ctx: PlanChaseContext): boolean {
  return (
    vectorExemptsPlanChase(ctx.direction, ctx.score, ctx.vector_pulse) ||
    regimeExemptsPlanChase(ctx)
  );
}

/** Combined G-19 top-band exemption. */
export function planG19Exempt(
  direction: "long" | "short",
  score: number,
  vector_pulse: ZeroDteVectorPulse | null | undefined,
  ctx: Omit<PlanChaseContext, "direction" | "score" | "vector_pulse">
): boolean {
  return (
    vectorExemptsG19TopBand(direction, score, vector_pulse) ||
    regimeExemptsG19TopBand({ direction, score, vector_pulse, ...ctx })
  );
}
