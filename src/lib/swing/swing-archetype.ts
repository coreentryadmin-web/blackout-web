// src/lib/swing/swing-archetype.ts — the archetype-specific PILLAR WEIGHT tables (FM#7).
//
// The swing evidence score is 7 pillars, but the WEIGHTS differ by archetype: a breakout is judged mostly
// on structure + relative strength; a flow-accumulation on flow persistence + strike concentration; a
// post-earnings/event on the catalyst response. Sharing one weight vector across archetypes would blur
// fundamentally different trades into one bucket (failure mode #7). Each archetype's vector sums to 100.
//
// CALIBRATION-FIRST: these weights are a DESIGNED PRIOR, not a graduated edge. SWING_PILLAR_WEIGHTS_GRADUATED
// is false — a weight vector only becomes "earned" once its archetype's graded bucket clears the ladder
// (calibration.ts). Until then the score is evidence surfaced on the desk, sizing/gating nothing.

import type { SwingArchetype } from "./taxonomy";
import { SWING_ARCHETYPES } from "./taxonomy";

/** The 7 evidence pillars, in stable render order (matches the operator's A–G spec). */
export type SwingPillar =
  | "STRUCTURE" //     A — price structure (trend, breakout quality, base, volume, invalidation geometry)
  | "REL_STRENGTH" //  B — strength vs SPY/QQQ, sector rank, leadership
  | "FLOW" //          C — multi-day directional premium, aggression, sweep, new-money, strike concentration
  | "VOLATILITY" //    D — IV percentile / term / expected move / skew + the contract's theta burden
  | "CATALYST" //      E — earnings/product/FDA/investor-day proximity + post-event drift (± binary hazard)
  | "REGIME" //        F — broad-market trend, risk-on/off, sector participation, breadth
  | "DATA_QUALITY"; //  G — feed completeness, catalyst/earnings-date certainty, quote freshness, agreement

export const SWING_PILLARS: readonly SwingPillar[] = [
  "STRUCTURE",
  "REL_STRENGTH",
  "FLOW",
  "VOLATILITY",
  "CATALYST",
  "REGIME",
  "DATA_QUALITY",
] as const;

/** The operator's base A–G point caps (25/15/20/15/10/10/5 = 100) — the default vector for an unclassified
 *  name and the reference the per-archetype vectors tilt away from. */
export const SWING_PILLAR_BASE_WEIGHTS: Record<SwingPillar, number> = {
  STRUCTURE: 25,
  REL_STRENGTH: 15,
  FLOW: 20,
  VOLATILITY: 15,
  CATALYST: 10,
  REGIME: 10,
  DATA_QUALITY: 5,
};

/** Provisional (ungraduated) — a weight vector only sizes/gates once its archetype bucket graduates.
 *
 *  CRITIQUE #6 (blocked-on-data): SECTOR_ROTATION is additionally flagged
 *  `ARCHETYPE_META.SECTOR_ROTATION.provisionalUntilIndustryRs === true`. A rotation thesis is only real
 *  if the name LEADS its INDUSTRY GROUP, and no industry-group relative-strength feed exists yet — so the
 *  REL_STRENGTH-heavy rotation vector below can't be verified. When the archetype-bucket graduation write
 *  lands, it MUST refuse to graduate any archetype carrying `provisionalUntilIndustryRs` until that feed
 *  ships, even if the graded bucket otherwise clears the ladder. Marker/comment only — no behavior here. */
export const SWING_PILLAR_WEIGHTS_GRADUATED = false;

/** Per-archetype weight vectors — each sums to 100. DATA_QUALITY is held at 5 everywhere (an honesty
 *  pillar, not a thesis pillar). Tilts follow the operator's spec: breakout→structure+relStr; flow-accum→
 *  flow; post-earnings/event→catalyst; sector-rotation→relStr+regime; mean-reversion→structure+vol. */
export const SWING_PILLAR_WEIGHTS_BY_ARCHETYPE: Record<SwingArchetype, Record<SwingPillar, number>> = {
  BREAKOUT: { STRUCTURE: 30, REL_STRENGTH: 20, FLOW: 15, VOLATILITY: 12, CATALYST: 6, REGIME: 12, DATA_QUALITY: 5 },
  PULLBACK_CONTINUATION: { STRUCTURE: 32, REL_STRENGTH: 18, FLOW: 13, VOLATILITY: 12, CATALYST: 6, REGIME: 14, DATA_QUALITY: 5 },
  MEAN_REVERSION: { STRUCTURE: 28, REL_STRENGTH: 10, FLOW: 12, VOLATILITY: 22, CATALYST: 6, REGIME: 17, DATA_QUALITY: 5 },
  FAILED_BREAKDOWN: { STRUCTURE: 30, REL_STRENGTH: 15, FLOW: 18, VOLATILITY: 12, CATALYST: 6, REGIME: 14, DATA_QUALITY: 5 },
  POST_EARNINGS_DRIFT: { STRUCTURE: 22, REL_STRENGTH: 15, FLOW: 15, VOLATILITY: 13, CATALYST: 20, REGIME: 10, DATA_QUALITY: 5 },
  FLOW_ACCUMULATION: { STRUCTURE: 18, REL_STRENGTH: 12, FLOW: 35, VOLATILITY: 12, CATALYST: 6, REGIME: 12, DATA_QUALITY: 5 },
  SECTOR_ROTATION: { STRUCTURE: 20, REL_STRENGTH: 28, FLOW: 12, VOLATILITY: 10, CATALYST: 5, REGIME: 20, DATA_QUALITY: 5 },
  EVENT_DRIVEN: { STRUCTURE: 18, REL_STRENGTH: 12, FLOW: 15, VOLATILITY: 15, CATALYST: 25, REGIME: 10, DATA_QUALITY: 5 },
};

/** The weight vector for an archetype, or the base vector when the name is unclassified (archetype null). */
export function weightsForArchetype(archetype: SwingArchetype | null): Record<SwingPillar, number> {
  return archetype == null ? SWING_PILLAR_BASE_WEIGHTS : SWING_PILLAR_WEIGHTS_BY_ARCHETYPE[archetype];
}

/** Sum of a weight vector — every shipped vector must be 100 (asserted in tests). Exported for the guard. */
export function weightSum(w: Record<SwingPillar, number>): number {
  return SWING_PILLARS.reduce((n, p) => n + (w[p] ?? 0), 0);
}

/** Every archetype (plus the base) is a complete, 100-summing vector — a runtime guard the tests assert and
 *  a future weight-graduation write must preserve. */
export function allArchetypeWeightVectors(): Array<{ archetype: SwingArchetype; weights: Record<SwingPillar, number> }> {
  return SWING_ARCHETYPES.map((a) => ({ archetype: a, weights: SWING_PILLAR_WEIGHTS_BY_ARCHETYPE[a] }));
}
