// src/lib/swing/taxonomy.ts — THE canonical swing taxonomy. Every swing module imports from here.
//
// No IO, no deps beyond horizon types. This file is the single source of truth for the archetype
// partition (the calibration key — a breakout and a mean-reversion must never share a scoring bucket:
// failure mode #7), the three contract sub-lanes (2–7 / 8–21 / 22–30 DTE are NOT one contract class:
// failure mode #2), and the pre-entry lifecycle vocabulary the serving router keys on. It carries NO
// score/weight logic — only the shapes + the DTE→sub-lane routing — so it can be imported everywhere
// (scorer, contract ranker, gates, manage, grader, calibration, serving) without a cycle.
//
// CALIBRATION-FIRST: every provisional floor here ships `scoreFloorGraduated:false`. A swing floor only
// goes live once its own archetype×sub-lane graded bucket clears the existing graduation ladder
// (calibration.ts: n≥10, delta≥15pt). See docs/audit/SWING-ENGINE.md.

import type { ContractPreference, ExitPrimitive, GraderTimeframe } from "../horizons";
import type { LiquidityGate } from "../horizon-fanout";

export const SWING_TAXONOMY_VERSION = 1;

// ─── Archetype (the partition key for weights + calibration; FM#7) ─────────────
// Eight buckets: specific enough to weight/grade distinctly, coarse enough that each is reachable for
// n≥10 graduation. (Pre-earnings momentum folds into EVENT_DRIVEN; vol-compression/expansion is a
// BREAKOUT sub-signal; trend-continuation folds into PULLBACK_CONTINUATION; gaps into EVENT_DRIVEN.)
export type SwingArchetype =
  | "BREAKOUT"
  | "PULLBACK_CONTINUATION"
  | "MEAN_REVERSION"
  | "FAILED_BREAKDOWN"
  | "POST_EARNINGS_DRIFT"
  | "FLOW_ACCUMULATION"
  | "SECTOR_ROTATION"
  | "EVENT_DRIVEN";

/** Stable render/iteration order. */
export const SWING_ARCHETYPES: readonly SwingArchetype[] = [
  "BREAKOUT",
  "PULLBACK_CONTINUATION",
  "MEAN_REVERSION",
  "FAILED_BREAKDOWN",
  "POST_EARNINGS_DRIFT",
  "FLOW_ACCUMULATION",
  "SECTOR_ROTATION",
  "EVENT_DRIVEN",
] as const;

/** Most-specific-first tie-break for the single-winner classifier (PR-3): when two archetype fits are
 *  within the classifier's confidence margin, the earlier (more specific) one wins. A permutation of
 *  SWING_ARCHETYPES. */
export const ARCHETYPE_PRIORITY: readonly SwingArchetype[] = [
  "EVENT_DRIVEN",
  "POST_EARNINGS_DRIFT",
  "FAILED_BREAKDOWN",
  "FLOW_ACCUMULATION",
  "SECTOR_ROTATION",
  "BREAKOUT",
  "PULLBACK_CONTINUATION",
  "MEAN_REVERSION",
] as const;

export interface ArchetypeMeta {
  id: SwingArchetype;
  label: string;
  note: string;
  /** PROVISIONAL per-archetype commit floor (evidence-only until graduated). */
  scoreFloor: number;
  /** v1: always false — an archetype's floor graduates on its OWN graded bucket, never on vibes. */
  scoreFloorGraduated: boolean;
}

export const ARCHETYPE_META: Record<SwingArchetype, ArchetypeMeta> = {
  BREAKOUT: {
    id: "BREAKOUT",
    label: "Breakout continuation",
    note: "Break from a multi-week base / range on volume; structure + relative strength lead the score.",
    scoreFloor: 62,
    scoreFloorGraduated: false,
  },
  PULLBACK_CONTINUATION: {
    id: "PULLBACK_CONTINUATION",
    label: "Pullback continuation",
    note: "Retrace to rising support inside an established trend; trend structure + entry geometry lead.",
    scoreFloor: 62,
    scoreFloorGraduated: false,
  },
  MEAN_REVERSION: {
    id: "MEAN_REVERSION",
    label: "Mean-reversion recovery",
    note: "Oversold snap-back toward the mean; the lowest-conviction lane — higher floor, tighter risk.",
    scoreFloor: 66,
    scoreFloorGraduated: false,
  },
  FAILED_BREAKDOWN: {
    id: "FAILED_BREAKDOWN",
    label: "Failed breakdown & reclaim",
    note: "Loss of support that reclaims — a trap reversal; structure + volume confirmation lead.",
    scoreFloor: 63,
    scoreFloorGraduated: false,
  },
  POST_EARNINGS_DRIFT: {
    id: "POST_EARNINGS_DRIFT",
    label: "Post-earnings drift",
    note: "Continuation after an earnings gap; catalyst response + continuation structure lead.",
    scoreFloor: 62,
    scoreFloorGraduated: false,
  },
  FLOW_ACCUMULATION: {
    id: "FLOW_ACCUMULATION",
    label: "Multi-day flow accumulation",
    note: "Stacked directional premium across sessions; flow persistence + strike concentration lead.",
    scoreFloor: 62,
    scoreFloorGraduated: false,
  },
  SECTOR_ROTATION: {
    id: "SECTOR_ROTATION",
    label: "Sector rotation leadership",
    note: "Relative-strength leadership as capital rotates into the group; sector + breadth lead.",
    scoreFloor: 63,
    scoreFloorGraduated: false,
  },
  EVENT_DRIVEN: {
    id: "EVENT_DRIVEN",
    label: "Event-driven directional",
    note: "A known catalyst (pre-earnings momentum, product/FDA/investor-day, gap) drives the thesis.",
    scoreFloor: 64,
    scoreFloorGraduated: false,
  },
};

// ─── Sub-lane (FM#2 — 2–30 DTE is three contract classes, not one) ─────────────
// Tactical (2–7): high gamma / fast theta / needs immediate timing → nearest-ITM, harshest theta penalty.
// Standard (8–21): the balanced directional swing → the default lane.
// Extended (22–30): slower structures / catalyst run-ups → more convexity, lenient theta, wider gate.
export type SwingSubLane = "TACTICAL" | "STANDARD" | "EXTENDED";

export const SWING_SUB_LANES_ORDER: readonly SwingSubLane[] = ["TACTICAL", "STANDARD", "EXTENDED"] as const;

export interface SwingSubLaneSpec {
  id: SwingSubLane;
  label: string;
  /** Contiguous, non-overlapping within [2,30]. */
  dteMin: number;
  dteMax: number;
  /** 0.50–0.75Δ directional stance (NOT the 0.35Δ banger) — the instrument tracks the underlying. */
  contract: ContractPreference;
  /** Extended tolerates wider spread / higher premium (slower, higher-priced contracts). */
  liquidity: LiquidityGate;
  /** "SCALE_OUT" for all swing lanes; kept per-lane so a future lane can diverge. */
  exit: ExitPrimitive;
  /** Grader timeframe for path/outcome truth — pinned per lane. */
  grader: GraderTimeframe;
  /** PROVISIONAL commit floor for the sub-lane (evidence-only until the sub-lane bucket graduates). */
  scoreFloor: number;
  scoreFloorGraduated: boolean;
  /** 0–1 Pillar-D theta-penalty weight (Tactical harsh, Extended lenient). */
  thetaSensitivity: number;
  /** 0–1 Pillar-E earnings-in-window hazard multiplier (shorter lanes carry more binary-gap risk). */
  earningsHazard: number;
}

export const SWING_SUB_LANES: Record<SwingSubLane, SwingSubLaneSpec> = {
  TACTICAL: {
    id: "TACTICAL",
    label: "Tactical (2–7d)",
    dteMin: 2,
    dteMax: 7,
    contract: { targetDelta: 0.65, deltaBand: [0.55, 0.75], note: "near-ITM, tracks underlying over 2–7d" },
    liquidity: { minOpenInterest: 400, maxSpreadPct: 0.18, maxPremiumPerShare: 35 },
    exit: "SCALE_OUT",
    grader: "minute",
    scoreFloor: 64,
    scoreFloorGraduated: false,
    thetaSensitivity: 1.0,
    earningsHazard: 1.0,
  },
  STANDARD: {
    id: "STANDARD",
    label: "Standard (8–21d)",
    dteMin: 8,
    dteMax: 21,
    contract: { targetDelta: 0.6, deltaBand: [0.5, 0.72], note: "directional 8–21d, breakeven inside target" },
    liquidity: { minOpenInterest: 250, maxSpreadPct: 0.25, maxPremiumPerShare: 45 },
    exit: "SCALE_OUT",
    grader: "hour",
    scoreFloor: 60,
    scoreFloorGraduated: false,
    thetaSensitivity: 0.6,
    earningsHazard: 0.6,
  },
  EXTENDED: {
    id: "EXTENDED",
    label: "Extended (22–30d)",
    dteMin: 22,
    dteMax: 30,
    contract: { targetDelta: 0.58, deltaBand: [0.5, 0.72], note: "time-in-thesis + convexity, 22–30d" },
    liquidity: { minOpenInterest: 200, maxSpreadPct: 0.32, maxPremiumPerShare: 55 },
    exit: "SCALE_OUT",
    grader: "day",
    scoreFloor: 60,
    scoreFloorGraduated: false,
    thetaSensitivity: 0.3,
    earningsHazard: 0.4,
  },
};

/** Which sub-lane owns a calendar DTE inside the SWING window, or null if outside [2,30]. */
export function subLaneForDte(dte: number): SwingSubLane | null {
  if (!Number.isFinite(dte)) return null;
  for (const id of SWING_SUB_LANES_ORDER) {
    const spec = SWING_SUB_LANES[id];
    if (dte >= spec.dteMin && dte <= spec.dteMax) return id;
  }
  return null;
}

/** Fast→slow order. */
export function allSwingSubLanes(): SwingSubLaneSpec[] {
  return SWING_SUB_LANES_ORDER.map((id) => SWING_SUB_LANES[id]);
}

// ─── Pre-entry maturity + entry position (the serving router keys on these) ────
// Setup maturity: FORMING (thesis building, not yet actionable) → TRIGGERED (in its valid entry window)
// → EXTENDED (moved too far past the trigger to enter cleanly) → INVALIDATED (structure broke). The
// serving router branches on these observable states, never on an ungraduated statistic.
export type SwingSetupState = "FORMING" | "TRIGGERED" | "EXTENDED" | "INVALIDATED";

/** Where price sits relative to the entry trigger — drives the entry-execution model + the board rail. */
export type SwingEntryState = "PRE_TRIGGER" | "AT_TRIGGER" | "PULLBACK_TO_ENTRY" | "EXTENDED_CHASE";
