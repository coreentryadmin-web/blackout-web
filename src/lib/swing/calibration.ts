// src/lib/swing/calibration.ts — the SWING graduation ladder (PR-16). Pure. No IO.
//
// THIS IS THE MECHANISM THAT *EARNS* GATING. Every swing prior — the per-archetype and per-sub-lane
// score floors, the archetype pillar-weight vectors, the edge gates (reward_risk_floor / entry_extended),
// the exit rungs, the contract-rank weights, and the allocation budget caps — ships PROVISIONAL
// (`scoreFloorGraduated:false` / `enforced:false` / `enforce:false`). Nothing in the swing lane sizes or
// blocks real risk on a designed number. A prior goes live ONLY when its OWN graded bucket clears the
// exact same bar the 0DTE lane graduates on:
//
//   • n ≥ ENFORCE_MIN_BLOCK_N (10) graded plays in the signal-ON bucket, AND
//   • a win-rate delta ≥ ENFORCE_MIN_DELTA_PTS (15) points vs its baseline.
//
// ZERO NEW GRADUATION MATH: these are DISTINCTLY-NAMED wrappers (SEV-7 — no name collision with the 0DTE
// analyzers) that each partition graded swing rows by their own bucket key, then call the 0DTE
// `recommendSignal` ladder VERBATIM (re-exported additively from zerodte/calibration.ts). The swing win
// predicate (`isSwingWin`: realized P&L > 0) is byte-identical to `isZeroDteWin` (plan P&L > 0), so mapping
// a swing row's realized P&L onto `plan_pnl_pct` reuses `bucketOf`/`rawWinRatePct` with no semantic drift —
// the two lanes can never diverge on what "a win" or "graduated" means.
//
// ONE FLAG PER BUCKET: a graduation write flips EXACTLY ONE flag for EXACTLY ONE bucket — this archetype's
// floor, that sub-lane's floor, this archetype's weight vector, this edge gate's `enforced`, this exit
// rung's enforcement, the contract-rank blend, or the allocation caps. A wrapper NEVER flips a global flag
// off one aggregate bucket; each verdict is scoped to the bucket that earned it. `graduated === (verdict
// === "enforce")` — provisional (false) on `insufficient_data` (n<10) and `keep_calibrating` (delta<15).
//
// NON-GATING: like the 0DTE module, this RETURNS verdicts. The live flip (taxonomy floor, weight vector,
// gate `enforced`, `graduatedRungs`, SWING_CONTRACT_RANK_GRADUATED, allocation `enforce`) is a separate
// write a human/PR still authorizes — this is the evidence bar that write must clear, not the write itself.

import {
  recommendSignal,
  bucketOf,
  type SignalRecommendation,
  type CalibrationBucket,
  type CalibrationPlayRow,
} from "../zerodte/calibration";
import {
  ARCHETYPE_META,
  SWING_ARCHETYPES,
  SWING_SUB_LANES,
  SWING_SUB_LANES_ORDER,
  type SwingArchetype,
  type SwingSubLane,
} from "./taxonomy";
import { SWING_PILLAR_WEIGHTS_GRADUATED } from "./swing-archetype";
import { SWING_CONTRACT_RANK_GRADUATED } from "./contract-ranker";

// ── The graded swing row the ladder reads ────────────────────────────────────────────────────────
// A structural SUBSET — the calibration never re-derives a grade, a classification, a gate verdict, or a
// rank; it reads what was PINNED at commit/grade time (the same discipline as 0DTE's CalibrationPlayRow).
// Every field is optional/nullable so a row missing a pinned key lands in that wrapper's no-read bucket,
// never a fabricated on/off vote.
export interface SwingCalibrationRow {
  /** Frozen realized plan P&L for the leg — the win basis (isSwingWin: >0). Null until graded. */
  realized_pnl_pct: number | null;
  /** Grade timestamp — a row is GRADED only when this is set AND realized P&L is finite. */
  graded_at?: string | null;
  /** The classified archetype (the weight/floor partition key), or null when unclassified. */
  archetype?: SwingArchetype | null;
  /** The DTE sub-lane at commit, or null when outside the 2–30 window. */
  sub_lane?: SwingSubLane | null;
  /** The committed evidence score — partitions floor/weight buckets by clears-provisional-floor. */
  score?: number | null;
  /** The edge exit rung that fired for this position (manage.ts), or null when none/held. */
  manage_rung?: SwingEdgeRung | null;
  /** Pinned would-block verdict per EDGE gate (gates.ts logs wouldBlock; enforced:false today). */
  gate_verdicts?: Partial<Record<SwingEdgeGate, boolean | null>> | null;
  /** True when the played contract scored in the ranker's top tier (contract-ranker weighted score). */
  contract_rank_top?: boolean | null;
  /** True when this position was INCLUDED despite tripping a swing-allocation cap flag (enforce:false). */
  allocation_breached_cap?: boolean | null;
}

/** The two EVIDENCE-ONLY edge gates (gates.ts) — the only swing gates that can graduate to enforcing. */
export type SwingEdgeGate = "reward_risk_floor" | "entry_extended";
export const SWING_EDGE_GATES: readonly SwingEdgeGate[] = ["reward_risk_floor", "entry_extended"] as const;

/** The evidence-only EXIT rungs (manage.ts, minus the four capital-preservation GATES + the no-ops). Each
 *  graduates on its OWN bucket into the manager's `graduatedRungs`. */
export type SwingEdgeRung =
  | "catalyst_shift"
  | "regime_shift"
  | "profit_ladder"
  | "flow_decay"
  | "rel_strength_loss"
  | "vol_collapse"
  | "time_stop"
  | "add_eligible";
export const SWING_EDGE_RUNGS: readonly SwingEdgeRung[] = [
  "catalyst_shift",
  "regime_shift",
  "profit_ladder",
  "flow_decay",
  "rel_strength_loss",
  "vol_collapse",
  "time_stop",
  "add_eligible",
] as const;

// ── Row plumbing (the ONE bridge into the reused 0DTE ladder) ─────────────────────────────────────

/** A swing row is graded when it has a grade stamp AND a finite realized P&L (identical rule to record.ts). */
export function isGradedSwingRow(row: SwingCalibrationRow): boolean {
  return row.graded_at != null && typeof row.realized_pnl_pct === "number" && Number.isFinite(row.realized_pnl_pct);
}

/**
 * Map a swing row's realized P&L onto a 0DTE CalibrationPlayRow so `recommendSignal`/`bucketOf` grade it
 * with ZERO new math. Only `plan_pnl_pct` is read by the ladder (via isZeroDteWin = plan_pnl_pct>0, which
 * matches isSwingWin = realized>0), so the other Pick fields are inert placeholders — never surfaced.
 */
function asPlayRow(realizedPnlPct: number | null): CalibrationPlayRow {
  return {
    session_date: "",
    ticker: "",
    direction: "long",
    score_max: 0,
    plan_outcome: null,
    plan_pnl_pct: realizedPnlPct,
    entry_context: null,
    gate_calibration_json: null,
  };
}

const toPlayRows = (rows: SwingCalibrationRow[]): CalibrationPlayRow[] =>
  rows.map((r) => asPlayRow(r.realized_pnl_pct));

/** The one-flag-per-bucket rule: a bucket graduates iff its reused verdict is `enforce`. */
const graduatedFrom = (rec: SignalRecommendation): boolean => rec.verdict === "enforce";

/**
 * The shared per-bucket graduation step: split already-graded rows into signal-ON / signal-OFF by a
 * documented binary, hand them to the reused `recommendSignal` ladder, and return the verdict + an overall
 * bucket summary. `noReadRows` are graded rows that carried no usable on/off signal for this bucket —
 * counted, never voted. THIS is the only place the ladder is invoked; every wrapper flows through it.
 */
function gradeBucket(
  signalName: string,
  onRows: SwingCalibrationRow[],
  offRows: SwingCalibrationRow[],
  noReadRows: SwingCalibrationRow[],
): { recommendation: SignalRecommendation; bucket: CalibrationBucket } {
  const recommendation = recommendSignal(signalName, toPlayRows(onRows), toPlayRows(offRows), noReadRows.length);
  const bucket = bucketOf(signalName, toPlayRows([...onRows, ...offRows]));
  return { recommendation, bucket };
}

// ── 1. Per-archetype score-floor graduation (flips ARCHETYPE_META[a].scoreFloorGraduated) ──────────
// Signal = the committed score CLEARED the archetype's provisional floor. The floor earns enforcement
// when clearing it beats being below it by ≥15pt at n≥10 — i.e. the floor actually separates winners.
export interface SwingArchetypeGraduation {
  archetype: SwingArchetype;
  provisionalFloor: number;
  recommendation: SignalRecommendation;
  /** The ONE flag this bucket can flip: ARCHETYPE_META[archetype].scoreFloorGraduated. */
  floorGraduated: boolean;
  bucket: CalibrationBucket;
}

export function analyzeArchetypeRecord(rows: SwingCalibrationRow[]): SwingArchetypeGraduation[] {
  const graded = rows.filter(isGradedSwingRow);
  return SWING_ARCHETYPES.map((archetype) => {
    const floor = ARCHETYPE_META[archetype].scoreFloor;
    const inBucket = graded.filter((r) => r.archetype === archetype);
    const { on, off, noRead } = partitionByFloor(inBucket, floor);
    const { recommendation, bucket } = gradeBucket(`archetype_floor:${archetype}`, on, off, noRead);
    return { archetype, provisionalFloor: floor, recommendation, floorGraduated: graduatedFrom(recommendation), bucket };
  });
}

// ── 2. Per-sub-lane score-floor graduation (flips SWING_SUB_LANES[sl].scoreFloorGraduated) ──────────
export interface SwingSubLaneGraduation {
  subLane: SwingSubLane;
  provisionalFloor: number;
  recommendation: SignalRecommendation;
  floorGraduated: boolean;
  bucket: CalibrationBucket;
}

export function analyzeSubLaneRecord(rows: SwingCalibrationRow[]): SwingSubLaneGraduation[] {
  const graded = rows.filter(isGradedSwingRow);
  return SWING_SUB_LANES_ORDER.map((subLane) => {
    const floor = SWING_SUB_LANES[subLane].scoreFloor;
    const inBucket = graded.filter((r) => r.sub_lane === subLane);
    const { on, off, noRead } = partitionByFloor(inBucket, floor);
    const { recommendation, bucket } = gradeBucket(`sublane_floor:${subLane}`, on, off, noRead);
    return { subLane, provisionalFloor: floor, recommendation, floorGraduated: graduatedFrom(recommendation), bucket };
  });
}

/** Split a bucket by whether the committed score cleared the provisional floor. Null score → no-read. */
function partitionByFloor(
  rows: SwingCalibrationRow[],
  floor: number,
): { on: SwingCalibrationRow[]; off: SwingCalibrationRow[]; noRead: SwingCalibrationRow[] } {
  const on: SwingCalibrationRow[] = [];
  const off: SwingCalibrationRow[] = [];
  const noRead: SwingCalibrationRow[] = [];
  for (const r of rows) {
    if (typeof r.score !== "number" || !Number.isFinite(r.score)) noRead.push(r);
    else if (r.score >= floor) on.push(r);
    else off.push(r);
  }
  return { on, off, noRead };
}

// ── 3. Pillar-weight-vector graduation (flips SWING_PILLAR_WEIGHTS_GRADUATED, per archetype) ────────
// The per-archetype weight vector PRODUCES the archetype's score. Signal-ON = rows carrying THIS archetype
// (scored with its bespoke vector); signal-OFF = the unclassified/base-weight rows (archetype null, scored
// with SWING_PILLAR_BASE_WEIGHTS). The vector earns "graduated" when the archetype-specific weighting
// separates winners better than the generic base vector by ≥15pt at n≥10 — i.e. the tilt actually pays.
export interface SwingPillarWeightGraduation {
  archetype: SwingArchetype;
  recommendation: SignalRecommendation;
  /** The ONE flag: this archetype's slice of SWING_PILLAR_WEIGHTS_GRADUATED. */
  weightsGraduated: boolean;
  /** The current global default (false in v1) — echoed so a consumer sees the provisional baseline. */
  provisionalGraduated: boolean;
  bucket: CalibrationBucket;
}

export function analyzePillarWeightRecord(rows: SwingCalibrationRow[]): SwingPillarWeightGraduation[] {
  const graded = rows.filter(isGradedSwingRow);
  const base = graded.filter((r) => r.archetype == null); // base-weight baseline
  return SWING_ARCHETYPES.map((archetype) => {
    const on = graded.filter((r) => r.archetype === archetype);
    const { recommendation, bucket } = gradeBucket(`pillar_weights:${archetype}`, on, base, []);
    return {
      archetype,
      recommendation,
      weightsGraduated: graduatedFrom(recommendation),
      provisionalGraduated: SWING_PILLAR_WEIGHTS_GRADUATED,
      bucket,
    };
  });
}

// ── 4. Exit-rung / scale-out graduation (flips each rung into manage.ts `graduatedRungs`) ───────────
// Signal-ON = the rung fired for this position; signal-OFF = it did not (held / other rung). A rung earns
// enforcement when the positions it acted on cleanly separate from the rest by ≥15pt at n≥10 — the exact
// evidence manage.ts waits on before it lets an edge rung stop counting as advisory.
export interface SwingRungGraduation {
  rung: SwingEdgeRung;
  recommendation: SignalRecommendation;
  /** The ONE flag: this rung joins the manager's graduated (enforced) rung set. */
  rungGraduated: boolean;
  bucket: CalibrationBucket;
}

export function analyzeSwingScaleOut(rows: SwingCalibrationRow[]): SwingRungGraduation[] {
  const graded = rows.filter(isGradedSwingRow);
  return SWING_EDGE_RUNGS.map((rung) => {
    const on = graded.filter((r) => r.manage_rung === rung);
    const off = graded.filter((r) => r.manage_rung != null && r.manage_rung !== rung);
    const noRead = graded.filter((r) => r.manage_rung == null); // no rung pinned → not a vote either way
    const { recommendation, bucket } = gradeBucket(`exit_rung:${rung}`, on, off, noRead);
    return { rung, recommendation, rungGraduated: graduatedFrom(recommendation), bucket };
  });
}

// ── 5. Edge-gate graduation (flips gates.ts reward_risk_floor / entry_extended enforced:false→true) ─
// A GATE earns enforcement when its would-BLOCK bucket UNDERperforms would-pass. recommendSignal enforces
// when signal-ON beats signal-OFF, so we pass ON = would_PASS, OFF = would_BLOCK: a ≥15pt pass-over-block
// win-rate edge at n≥10 (pass bucket) means the gate's block verdict is catching genuinely worse trades →
// enforce. Rows with no pinned verdict for the gate are no-read.
export interface SwingGateGraduation {
  gate: SwingEdgeGate;
  recommendation: SignalRecommendation;
  /** The ONE flag: this gate's `enforced` in gates.ts flips false→true. */
  enforced: boolean;
  bucket: CalibrationBucket;
}

export function analyzeSwingGateCalibration(rows: SwingCalibrationRow[]): SwingGateGraduation[] {
  const graded = rows.filter(isGradedSwingRow);
  return SWING_EDGE_GATES.map((gate) => {
    const wouldPass: SwingCalibrationRow[] = [];
    const wouldBlock: SwingCalibrationRow[] = [];
    const noRead: SwingCalibrationRow[] = [];
    for (const r of graded) {
      const v = r.gate_verdicts?.[gate];
      if (v === true) wouldBlock.push(r);
      else if (v === false) wouldPass.push(r);
      else noRead.push(r);
    }
    // ON = would_pass, OFF = would_block → delta = pass − block; ≥15pt means block underperforms → enforce.
    const { recommendation, bucket } = gradeBucket(`edge_gate:${gate}`, wouldPass, wouldBlock, noRead);
    return { gate, recommendation, enforced: graduatedFrom(recommendation), bucket };
  });
}

// ── 6. Contract-rank-weight graduation (flips SWING_CONTRACT_RANK_GRADUATED) ────────────────────────
// Signal-ON = the played contract scored in the ranker's TOP tier (its weighted tradability×thesisFit put
// it at the front); signal-OFF = a lower-tier fill. The rank BLEND earns enforcement (sizes/gates) when
// top-tier picks beat lower-tier ones by ≥15pt at n≥10 — the evidence that the weighted ordering, not just
// the mechanical eligibility filter, is predictive. One global flag (the blend is archetype-agnostic).
export interface SwingContractRankGraduation {
  recommendation: SignalRecommendation;
  /** The ONE flag: SWING_CONTRACT_RANK_GRADUATED false→true. */
  rankGraduated: boolean;
  provisionalGraduated: boolean;
  bucket: CalibrationBucket;
}

export function analyzeContractRankCalibration(rows: SwingCalibrationRow[]): SwingContractRankGraduation {
  const graded = rows.filter(isGradedSwingRow);
  const on = graded.filter((r) => r.contract_rank_top === true);
  const off = graded.filter((r) => r.contract_rank_top === false);
  const noRead = graded.filter((r) => r.contract_rank_top == null);
  const { recommendation, bucket } = gradeBucket("contract_rank_top_tier", on, off, noRead);
  return {
    recommendation,
    rankGraduated: graduatedFrom(recommendation),
    provisionalGraduated: SWING_CONTRACT_RANK_GRADUATED,
    bucket,
  };
}

// ── 7. Allocation budget-cap graduation (flips swing-allocation.ts enforce:false→true) ─────────────
// Signal-ON = positions taken WITHIN the caps (no cap flag tripped); signal-OFF = positions taken while
// breaching a cap (the over-concentrated / over-weight ones the advisory sizing would have SKIPPED). The
// caps earn enforcement when within-cap positions beat cap-breaching ones by ≥15pt at n≥10 — the evidence
// that respecting the budget actually protects the book. One global flag (the whole cap set enforces together).
export interface SwingAllocationGraduation {
  recommendation: SignalRecommendation;
  /** The ONE flag: swing-allocation.ts result `enforce` false→true. */
  capsEnforced: boolean;
  bucket: CalibrationBucket;
}

export function analyzeAllocationRecord(rows: SwingCalibrationRow[]): SwingAllocationGraduation {
  const graded = rows.filter(isGradedSwingRow);
  const withinCap = graded.filter((r) => r.allocation_breached_cap === false);
  const breachedCap = graded.filter((r) => r.allocation_breached_cap === true);
  const noRead = graded.filter((r) => r.allocation_breached_cap == null);
  // ON = within-cap, OFF = breached → delta = within − breached; ≥15pt means breaches underperform → enforce.
  const { recommendation, bucket } = gradeBucket("allocation_within_cap", withinCap, breachedCap, noRead);
  return { recommendation, capsEnforced: graduatedFrom(recommendation), bucket };
}

// ── The whole-lane report (one call, every bucket) ─────────────────────────────────────────────────
export interface SwingCalibrationReport {
  methodology: string;
  graded_plays: number;
  archetype_floors: SwingArchetypeGraduation[];
  sub_lane_floors: SwingSubLaneGraduation[];
  pillar_weights: SwingPillarWeightGraduation[];
  exit_rungs: SwingRungGraduation[];
  edge_gates: SwingGateGraduation[];
  contract_rank: SwingContractRankGraduation;
  allocation: SwingAllocationGraduation;
  available: boolean;
}

export const SWING_CALIBRATION_METHODOLOGY =
  "Swing graduation over GRADED roll-chain legs (win = realized plan P&L > 0, identical to the 0DTE " +
  "record + feature store). Every prior — archetype/sub-lane floor, pillar-weight vector, edge gate, exit " +
  "rung, contract-rank blend, allocation caps — stays provisional until its OWN bucket clears n>=10 graded " +
  "plays AND a >=15pt win-rate delta vs its baseline (the reused 0DTE recommendSignal ladder). Exactly one " +
  "flag flips per graduated bucket. Non-gating: the report is the evidence bar, the live flip is a human/PR write.";

/** Run every swing graduation wrapper over one graded-row set — the whole-lane evidence snapshot. */
export function analyzeSwingCalibration(rows: SwingCalibrationRow[]): SwingCalibrationReport {
  const graded = rows.filter(isGradedSwingRow);
  return {
    methodology: SWING_CALIBRATION_METHODOLOGY,
    graded_plays: graded.length,
    archetype_floors: analyzeArchetypeRecord(rows),
    sub_lane_floors: analyzeSubLaneRecord(rows),
    pillar_weights: analyzePillarWeightRecord(rows),
    exit_rungs: analyzeSwingScaleOut(rows),
    edge_gates: analyzeSwingGateCalibration(rows),
    contract_rank: analyzeContractRankCalibration(rows),
    allocation: analyzeAllocationRecord(rows),
    available: graded.length > 0,
  };
}
