/**
 * Market State Engine (v0) — regime-adaptive rail priors for 0DTE discovery.
 *
 * Reads the session regime (classifyRegime output) and emits per-rail weight multipliers
 * applied to candidate scores at merge time. Does NOT auto-commit or mutate gates — shadow-safe.
 *
 * Design: confidence-scaled weights. Low-confidence regime → 1.0 on all rails (today's behavior).
 */

import type { MarketRegime, StructureRegime } from "./regime";

export type DiscoveryRail = "FLOW" | "BREAKOUT" | "PIN";

export type RailWeightMap = Record<DiscoveryRail, number>;

export type MarketStateSnapshot = {
  session_date: string;
  regime_structure: StructureRegime | null;
  regime_vol: string | null;
  regime_label: string | null;
  /** 0–1 — how much to trust rail reweighting (ramps with regime clarity). */
  confidence: number;
  rail_weights: RailWeightMap;
  /** Human one-liner for ops/UI — no vendor names. */
  summary: string;
  /** Phase 2c — shadow calibration priors blended into rail_weights when enabled. */
  calibration_shadow?: {
    active: boolean;
    blend: number;
    rail_weights: RailWeightMap;
    confidence: number;
  } | null;
};

/** Baseline priors before regime adjustment (equal rails). */
export const BASE_RAIL_WEIGHTS: RailWeightMap = { FLOW: 1, BREAKOUT: 1, PIN: 1 };

/** Max deviation from 1.0 per rail (calibration guardrail). */
export const MAX_RAIL_WEIGHT_DELTA = 0.35;

function clampWeight(w: number): number {
  return Math.round(Math.max(1 - MAX_RAIL_WEIGHT_DELTA, Math.min(1 + MAX_RAIL_WEIGHT_DELTA, w)) * 1000) / 1000;
}

/**
 * Regime → raw rail priors (before confidence blending).
 * Trend days: FLOW + BREAKOUT up, PIN down. Range/chop: PIN up, BREAKOUT down.
 */
export function rawRailWeightsForStructure(structure: StructureRegime | null): RailWeightMap {
  switch (structure) {
    case "TREND_UP":
    case "TREND_DOWN":
      return { FLOW: 1.25, BREAKOUT: 1.2, PIN: 0.65 };
    case "RANGE":
    case "INSIDE":
      return { FLOW: 0.95, BREAKOUT: 0.75, PIN: 1.25 };
    default:
      return { ...BASE_RAIL_WEIGHTS };
  }
}

/** Confidence in regime read — stronger on clear trend/range, weaker on ambiguous structure. */
export function regimeConfidence(regime: MarketRegime | null): number {
  if (!regime) return 0;
  if (regime.structure === "TREND_UP" || regime.structure === "TREND_DOWN") return 0.85;
  if (regime.structure === "RANGE" && regime.vol !== "HIGH_IV") return 0.75;
  if (regime.structure === "INSIDE") return 0.7;
  return 0.5;
}

/** Blend raw weights toward 1.0 when confidence is low. */
export function blendRailWeights(raw: RailWeightMap, confidence: number): RailWeightMap {
  const c = Math.max(0, Math.min(1, confidence));
  const blend = (w: number) => clampWeight(1 + (w - 1) * c);
  return {
    FLOW: blend(raw.FLOW),
    BREAKOUT: blend(raw.BREAKOUT),
    PIN: blend(raw.PIN),
  };
}

/** Blend regime rail weights with shadow calibration priors (Phase 2c). Pure. */
export function blendRegimeWithCalibrationPriors(
  regimeWeights: RailWeightMap,
  calibrationWeights: RailWeightMap,
  blend: number
): RailWeightMap {
  const b = Math.max(0, Math.min(1, blend));
  if (b <= 0) return { ...regimeWeights };
  const mix = (key: DiscoveryRail) =>
    clampWeight(regimeWeights[key] * (1 - b) + calibrationWeights[key] * b);
  return { FLOW: mix("FLOW"), BREAKOUT: mix("BREAKOUT"), PIN: mix("PIN") };
}

export function buildMarketState(input: {
  regime: MarketRegime | null;
  sessionDate: string;
  /** Optional shadow calibration priors from Redis (Phase 2c). */
  shadowCalibration?: {
    rail_weights: RailWeightMap;
    confidence: number;
    blend: number;
  } | null;
}): MarketStateSnapshot {
  const confidence = regimeConfidence(input.regime);
  const raw = rawRailWeightsForStructure(input.regime?.structure ?? null);
  let rail_weights = blendRailWeights(raw, confidence);
  const structure = input.regime?.structure ?? null;

  let calibration_shadow: MarketStateSnapshot["calibration_shadow"] = null;
  const shadow = input.shadowCalibration;
  if (shadow && shadow.blend > 0 && shadow.confidence > 0) {
    const effectiveBlend = shadow.blend * shadow.confidence;
    rail_weights = blendRegimeWithCalibrationPriors(rail_weights, shadow.rail_weights, effectiveBlend);
    calibration_shadow = {
      active: true,
      blend: effectiveBlend,
      rail_weights: shadow.rail_weights,
      confidence: shadow.confidence,
    };
  }

  const calNote =
    calibration_shadow?.active === true
      ? ` · cal×${Math.round(calibration_shadow.blend * 100)}%`
      : "";
  const summary =
    confidence >= 0.7 && structure
      ? `${structure.replace("_", " ").toLowerCase()} session — FLOW×${rail_weights.FLOW} BREAKOUT×${rail_weights.BREAKOUT} PIN×${rail_weights.PIN}${calNote}`
      : calibration_shadow?.active
        ? `Mixed regime — calibration-blended rails${calNote}`
        : "Mixed regime — equal rail weights";

  return {
    session_date: input.sessionDate,
    regime_structure: structure,
    regime_vol: input.regime?.vol ?? null,
    regime_label: input.regime?.label ?? null,
    confidence,
    rail_weights,
    summary,
    calibration_shadow,
  };
}

/** Weighted score for merge ranking when multiple origins present — uses max rail weight. */
export function weightedScoreForMerge(
  score: number,
  origins: readonly string[] | null | undefined,
  state: MarketStateSnapshot | null
): number {
  if (!state || !Number.isFinite(score)) return score;
  const set = (origins ?? []).map((o) => o.toUpperCase());
  let w = 1;
  for (const o of set) {
    const key = o as DiscoveryRail;
    if (key in state.rail_weights) w = Math.max(w, state.rail_weights[key as DiscoveryRail]);
  }
  if (set.length === 0) w = state.rail_weights.FLOW;
  return Math.round(score * w * 10) / 10;
}
