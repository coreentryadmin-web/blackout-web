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

export function buildMarketState(input: {
  regime: MarketRegime | null;
  sessionDate: string;
}): MarketStateSnapshot {
  const confidence = regimeConfidence(input.regime);
  const raw = rawRailWeightsForStructure(input.regime?.structure ?? null);
  const rail_weights = blendRailWeights(raw, confidence);
  const structure = input.regime?.structure ?? null;
  const summary =
    confidence >= 0.7 && structure
      ? `${structure.replace("_", " ").toLowerCase()} session — FLOW×${rail_weights.FLOW} BREAKOUT×${rail_weights.BREAKOUT} PIN×${rail_weights.PIN}`
      : "Mixed regime — equal rail weights";

  return {
    session_date: input.sessionDate,
    regime_structure: structure,
    regime_vol: input.regime?.vol ?? null,
    regime_label: input.regime?.label ?? null,
    confidence,
    rail_weights,
    summary,
  };
}

/** Primary discovery origin on a setup → rail key. */
export function primaryRailFromOrigins(origins: readonly string[] | null | undefined): DiscoveryRail {
  const set = new Set((origins ?? []).map((o) => o.toUpperCase()));
  if (set.has("FLOW")) return "FLOW";
  if (set.has("BREAKOUT")) return "BREAKOUT";
  if (set.has("PIN")) return "PIN";
  return "FLOW";
}

/**
 * Apply market-state rail weight to a candidate score (pure, idempotent).
 * Returns rounded score — used at merge/sort only, never overwrites raw score in DB.
 */
export function applyRailWeightToScore(
  score: number,
  origins: readonly string[] | null | undefined,
  state: MarketStateSnapshot | null
): number {
  if (!state || !Number.isFinite(score)) return score;
  const rail = primaryRailFromOrigins(origins);
  const w = state.rail_weights[rail] ?? 1;
  return Math.round(score * w * 10) / 10;
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
