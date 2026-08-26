/**
 * Platform context for Vector's Suggested Play — fuses desk-adjacent reads the chart already
 * surfaces (HELIX session flow, dark-pool levels) into the play engine WITHOUT a second
 * conviction model. Pure: no Date.now, no network.
 */
import type { VectorPlayBias } from "./vector-play-engine";
import type { VectorDarkPoolLevel } from "./vector-dark-pool-levels";

export type PlayFlowBias = "bull" | "bear" | "mixed";

export type PlayPlatformFlowPrint = {
  option_type?: string | null;
  premium?: number | null;
  strike?: number | null;
};

export type PlayPlatformContext = {
  flowBias: PlayFlowBias | null;
  flowCallPremium: number;
  flowPutPremium: number;
  flowConfirmPremium: number;
  darkPoolNearRef: { strike: number; pct: number } | null;
};

export type PlayPlatformInputs = {
  sessionFlows?: readonly PlayPlatformFlowPrint[] | null;
  darkPoolLevels?: readonly VectorDarkPoolLevel[] | null;
};

const FLOW_MIN_PREMIUM = 200_000;
const NEAR_REF_TOL_PCT = 0.0035;

function num(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function summarizeSessionFlowBias(
  flows: readonly PlayPlatformFlowPrint[] | null | undefined
): { bias: PlayFlowBias; callPremium: number; putPremium: number } | null {
  if (!flows?.length) return null;
  let callPremium = 0;
  let putPremium = 0;
  for (const f of flows) {
    const prem = num(f.premium);
    if (prem == null || prem < FLOW_MIN_PREMIUM) continue;
    const side = f.option_type?.toUpperCase();
    if (side === "CALL") callPremium += prem;
    else if (side === "PUT") putPremium += prem;
  }
  const total = callPremium + putPremium;
  if (total <= 0) return null;
  const ratio = callPremium / total;
  let bias: PlayFlowBias;
  if (ratio >= 0.62) bias = "bull";
  else if (ratio <= 0.38) bias = "bear";
  else bias = "mixed";
  return { bias, callPremium, putPremium };
}

export function largestAlignedFlowPremium(
  flows: readonly PlayPlatformFlowPrint[] | null | undefined,
  bias: VectorPlayBias
): number {
  if (!flows?.length || bias === "neutral" || bias === "range") return 0;
  let best = 0;
  for (const f of flows) {
    const prem = num(f.premium);
    if (prem == null || prem < FLOW_MIN_PREMIUM) continue;
    const side = f.option_type?.toUpperCase();
    const aligned =
      (bias === "long" && side === "CALL") ||
      (bias === "short" && side === "PUT");
    if (aligned && prem > best) best = prem;
  }
  return best;
}

export function darkPoolNearReference(
  levels: readonly VectorDarkPoolLevel[] | null | undefined,
  refLevel: number | null,
  spot: number
): { strike: number; pct: number } | null {
  const ref = num(refLevel);
  if (ref == null || !(spot > 0) || !levels?.length) return null;
  const tol = spot * NEAR_REF_TOL_PCT;
  let best: { strike: number; pct: number; dist: number } | null = null;
  for (const lv of levels) {
    const strike = num(lv.strike);
    if (strike == null) continue;
    const dist = Math.abs(strike - ref);
    if (dist > tol) continue;
    if (!best || dist < best.dist || (dist === best.dist && lv.pct > best.pct)) {
      best = { strike, pct: lv.pct, dist };
    }
  }
  return best ? { strike: best.strike, pct: best.pct } : null;
}

export function derivePlayPlatformContext(
  inputs: PlayPlatformInputs,
  bias: VectorPlayBias,
  refLevel: number | null,
  spot: number
): PlayPlatformContext | null {
  const flow = summarizeSessionFlowBias(inputs.sessionFlows);
  const darkPoolNearRef = darkPoolNearReference(inputs.darkPoolLevels, refLevel, spot);
  const flowConfirmPremium = largestAlignedFlowPremium(inputs.sessionFlows, bias);
  if (!flow && !darkPoolNearRef && flowConfirmPremium <= 0) return null;
  return {
    flowBias: flow?.bias ?? null,
    flowCallPremium: flow?.callPremium ?? 0,
    flowPutPremium: flow?.putPremium ?? 0,
    flowConfirmPremium,
    darkPoolNearRef,
  };
}

export function platformConvictionDelta(
  ctx: PlayPlatformContext | null | undefined,
  bias: VectorPlayBias
): number {
  if (!ctx || bias === "neutral") return 0;
  let delta = 0;
  if (ctx.flowBias === "bull" && bias === "long") delta += 8;
  else if (ctx.flowBias === "bear" && bias === "short") delta += 8;
  else if (ctx.flowBias === "bull" && bias === "short") delta -= 7;
  else if (ctx.flowBias === "bear" && bias === "long") delta -= 7;
  if (ctx.flowConfirmPremium >= 1_000_000) delta += 4;
  else if (ctx.flowConfirmPremium >= 500_000) delta += 2;
  if (ctx.darkPoolNearRef) delta += bias === "range" ? 3 : 4;
  return delta;
}

export function platformStarredLine(ctx: PlayPlatformContext | null | undefined): string | null {
  if (!ctx) return null;
  const parts: string[] = [];
  if (ctx.flowBias && (ctx.flowCallPremium > 0 || ctx.flowPutPremium > 0)) {
    const callM = Math.round(ctx.flowCallPremium / 1_000_000);
    const putM = Math.round(ctx.flowPutPremium / 1_000_000);
    parts.push(`HELIX flow ${ctx.flowBias} (${callM}M calls / ${putM}M puts today)`);
  }
  if (ctx.darkPoolNearRef) {
    parts.push(
      `Dark pool ${ctx.darkPoolNearRef.strike} (${ctx.darkPoolNearRef.pct.toFixed(0)}% of tape) at this level`
    );
  }
  return parts.length ? parts.join(" · ") : null;
}
