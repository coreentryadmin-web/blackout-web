/**
 * Cortex relief when Vector is already printing a winner/runner in the SAME direction.
 * Stops gate survivors from dying on gex-walls veto / net-negative while Vector proves the tape.
 */
import type { ZeroDteVectorPulse } from "./vector-crosslink-core";
import { vectorExemptsG17PrimeBand } from "./vector-commit-boost";
import {
  assessCortexVerdict,
  type ZeroDteCortexAssessment,
} from "./cortex-gate";
import { isAmplifyMomentumRegime, type PlanChaseContext } from "./chase-exempt";

const GEX_WALLS_SOURCE = "gex-walls";

function flowBacked(origins: readonly string[] | null | undefined): boolean {
  const set = Array.isArray(origins) ? origins : [];
  return set.length === 0 || set.includes("FLOW");
}

/** Vector-aligned winner/runner — full Cortex block relief (gex veto strip + net-negative pass). */
export function vectorExemptsCortexBlocks(
  direction: "long" | "short",
  score: number,
  pulse: ZeroDteVectorPulse | null | undefined
): boolean {
  if (process.env.ZERODTE_VECTOR_CORTEX_RELIEF === "0") return false;
  return vectorExemptsG17PrimeBand(direction, score, pulse);
}

/** Amplify-session FLOW 85+ tape-aligned — net-negative relief only (not vetoes). */
export function regimeExemptsCortexNetNegative(ctx: PlanChaseContext): boolean {
  if (process.env.ZERODTE_AMPLIFY_CORTEX_RELIEF === "0") return false;
  if (!isAmplifyMomentumRegime(ctx)) return false;
  if (!flowBacked(ctx.discovery_origin)) return false;
  if (ctx.market_aligned !== true) return false;
  if (ctx.score < 85) return false;
  return true;
}

/**
 * Apply Vector/regime Cortex relief to a fresh assessment before cortexGateBlocks.
 * Pure — safe to unit-test with fixture verdicts.
 */
export function applyCortexCommitRelief(
  assessment: ZeroDteCortexAssessment,
  direction: "long" | "short",
  score: number,
  pulse: ZeroDteVectorPulse | null | undefined,
  ctx: PlanChaseContext,
  opts?: { failClosedOnVetoBlind?: boolean }
): ZeroDteCortexAssessment {
  if (assessment.abstained || assessment.decision === "PASS") return assessment;

  const vectorRelief = vectorExemptsCortexBlocks(direction, score, pulse);
  const regimeNetRelief = regimeExemptsCortexNetNegative(ctx);

  if (!vectorRelief && !regimeNetRelief) return assessment;

  if (assessment.decision === "VETO" && vectorRelief) {
    const kept = assessment.verdict.vetoes.filter((v) => v.source !== GEX_WALLS_SOURCE);
    if (kept.length === assessment.verdict.vetoes.length) return assessment;
    const nextVerdict = { ...assessment.verdict, vetoes: kept };
    if (kept.length > 0) {
      return { decision: "VETO", abstained: false, verdict: nextVerdict };
    }
    const reassessed = assessCortexVerdict(nextVerdict, opts);
    if (reassessed.decision === "PASS") return reassessed;
    return { decision: "PASS", abstained: false, verdict: nextVerdict };
  }

  if (
    vectorRelief &&
    (assessment.decision === "NET_NEGATIVE" ||
      assessment.decision === "OPPOSE_UNRESOLVED" ||
      assessment.decision === "CONTESTED")
  ) {
    return { decision: "PASS", abstained: false, verdict: assessment.verdict };
  }

  if (regimeNetRelief && assessment.decision === "NET_NEGATIVE") {
    return { decision: "PASS", abstained: false, verdict: assessment.verdict };
  }

  return assessment;
}
