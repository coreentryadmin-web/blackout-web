// src/lib/swing/calibration.ts — the SWING graduation ladder (PR-16 → STAGED, this PR). Pure. No IO.
//
// THIS IS THE MECHANISM THAT *EARNS* GATING. Every swing prior — the per-archetype and per-sub-lane
// score floors, the archetype pillar-weight vectors, the edge gates (reward_risk_floor / entry_extended),
// the exit rungs, the contract-rank weights, and the allocation budget caps — ships PROVISIONAL
// (`scoreFloorGraduated:false` / `enforced:false` / `enforce:false`). Nothing in the swing lane sizes or
// blocks real risk on a designed number.
//
// WHY SWING GETS A HARSHER, STAGED LADDER THAN 0DTE (the operator's #1 critique, addressed here):
// The inherited binary bar — "n ≥ 10 graded plays AND win-rate Δ ≥ 15pt vs baseline, then enforce" — is
// fine as the FIRST evidence that a prior might matter, but it is far too low and too BLUNT to be the sole
// trigger for PERMANENT enforcement in the swing lane, for two structural reasons:
//   1. Small-n flukes. At n=10 a single flipped play moves the bucket rate by 10pt, and a 10-of-10 run is a
//      coin-flip event roughly 1-in-1000 — but there are 24+ archetype × sub-lane buckets (8 archetypes ×
//      3 sub-lanes) plus gates/rungs/rank/caps all grading in parallel, so a 10-of-10 "clears the bar"
//      fluke SOMEWHERE is close to inevitable. A raw point estimate cannot tell that apart from a real edge.
//      So the graduation decision now rests on the WILSON SCORE lower bound of the on-signal win rate (the
//      smallest rate the observed record is statistically consistent with), NOT the raw rate — a 10-of-10
//      bucket has a Wilson-LB of only ~0.72, so it can no longer "graduate" on luck.
//   2. Permanence vs. shadow. n=10 is enough to START SHADOWING a prior (log what it WOULD do), never
//      enough to hand it live enforcement authority forever. So graduation is now STAGED by graded-sample
//      count: n<10 = RESEARCH (no promotion), n=10–29 = PROVISIONAL_SHADOW (log a would-enforce, NEVER
//      enforces), n=30–74 = LIMITED (eligible for limited enforcement), n≥75 = BROAD. A bucket only
//      "graduates" (`graduated:true`) in LIMITED/BROAD AND when the Wilson-LB gate passes AND the raw
//      point-Δ still clears 15pt. The old n=10 → enforce path is now PROVISIONAL_SHADOW → graduated:false.
//
// The Wilson-LB gate: the on-signal Wilson lower bound (as a %) must beat the off-signal point rate by
// ENFORCE_MIN_DELTA_PTS, OR clear the absolute floor SWING_GRADUATION_WILSON_ABS_FLOOR — either proves the
// edge survives its own small-sample uncertainty, not just the midpoint.
//
// ZERO NEW POINT-ESTIMATE MATH: these are DISTINCTLY-NAMED wrappers (SEV-7 — no name collision with the
// 0DTE analyzers) that each partition graded swing rows by their own bucket key, then call the 0DTE
// `recommendSignal` ladder VERBATIM (re-exported additively from zerodte/calibration.ts) for the point-Δ,
// and layer the swing-only STAGED tier + Wilson-LB gate on top. The swing win predicate (realized P&L > 0)
// is byte-identical to `isZeroDteWin` (plan P&L > 0), so mapping a swing row's realized P&L onto
// `plan_pnl_pct` reuses `bucketOf`/`rawWinRatePct` with no drift — the point-Δ half can never diverge from
// 0DTE; only the harsher staged/Wilson gate on top is swing-specific.
//
// ONE FLAG PER BUCKET: a graduation write flips EXACTLY ONE flag for EXACTLY ONE bucket — this archetype's
// floor, that sub-lane's floor, this archetype's weight vector, this edge gate's `enforced`, this exit
// rung's enforcement, the contract-rank blend, or the allocation caps. A wrapper NEVER flips a global flag
// off one aggregate bucket; each verdict is scoped to the bucket that earned it. The domain boolean
// (`floorGraduated`/`enforced`/…) now equals the STAGED `graduated` (LIMITED/BROAD ∧ Wilson-LB ∧ Δ≥15),
// NOT the raw `verdict === "enforce"`.
//
// NON-GATING: like the 0DTE module, this RETURNS verdicts. The live flip (taxonomy floor, weight vector,
// gate `enforced`, `graduatedRungs`, SWING_CONTRACT_RANK_GRADUATED, allocation `enforce`) is a separate
// write a human/PR still authorizes — this is the evidence bar that write must clear, not the write itself.

import {
  recommendSignal,
  bucketOf,
  rawWinRatePct,
  ENFORCE_MIN_DELTA_PTS,
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

// ── The STAGED graduation ladder + uncertainty bounds (the swing-only harshening) ──────────────────

/** The four staged rungs, by graded on-signal sample count. RESEARCH/PROVISIONAL_SHADOW can NEVER
 *  enforce (they only produce evidence / a shadow would-enforce log); LIMITED/BROAD are the only
 *  tiers eligible for a live flip. See the header for WHY n=10 shadows but does not enforce. */
export type SwingGraduationTier = "RESEARCH" | "PROVISIONAL_SHADOW" | "LIMITED" | "BROAD";

/** The ladder itself — ordered, machine-readable, `maxN: null` = open-ended. `enforcementEligible`
 *  is the ONLY tier property that lets a bucket graduate; the Wilson-LB + point-Δ gates ride on top. */
export const SWING_GRADUATION_TIERS: ReadonlyArray<{
  tier: SwingGraduationTier;
  minN: number;
  maxN: number | null;
  enforcementEligible: boolean;
  note: string;
}> = [
  { tier: "RESEARCH", minN: 0, maxN: 9, enforcementEligible: false, note: "n<10 — research only, no promotion of any kind." },
  { tier: "PROVISIONAL_SHADOW", minN: 10, maxN: 29, enforcementEligible: false, note: "n=10–29 — log a would-enforce (shadow); NEVER enforces. The inherited n>=10 bar earns SHADOW, not live gating." },
  { tier: "LIMITED", minN: 30, maxN: 74, enforcementEligible: true, note: "n=30–74 — eligible for LIMITED enforcement once Wilson-LB + Δ>=15pt also clear." },
  { tier: "BROAD", minN: 75, maxN: null, enforcementEligible: true, note: "n>=75 — eligible for BROADER enforcement once Wilson-LB + Δ>=15pt also clear." },
] as const;

/** Pure staged-tier lookup by graded on-signal sample count. Boundaries: 9→RESEARCH, 10→SHADOW,
 *  29→SHADOW, 30→LIMITED, 74→LIMITED, 75→BROAD. Negative/NaN clamps to RESEARCH (defensive). */
export function swingGraduationTier(n: number): SwingGraduationTier {
  if (!Number.isFinite(n) || n < 10) return "RESEARCH";
  if (n < 30) return "PROVISIONAL_SHADOW";
  if (n < 75) return "LIMITED";
  return "BROAD";
}

/** Only LIMITED/BROAD can ever hand a prior live enforcement — the eligibility half of `graduated`. */
const tierEnforcementEligible = (t: SwingGraduationTier): boolean => t === "LIMITED" || t === "BROAD";

/**
 * Wilson score interval LOWER bound for a binomial proportion (wins/n) at confidence z (default 1.96 =
 * 95%). This is the smallest true win rate the observed record is consistent with — the guard against a
 * small-sample fluke reading like an edge. Worked example: 10/10 → ~0.7225 (NOT 1.0), so a 10-of-10 run
 * can no longer graduate on the point estimate alone. Returns 0 for n<=0 (no evidence → no lower bound).
 *
 *   LB = ( p̂ + z²/2n − z·√( (p̂(1−p̂) + z²/4n) / n ) ) / ( 1 + z²/n )
 */
export function wilsonLowerBound(wins: number, n: number, z = 1.96): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const phat = wins / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = phat + z2 / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n);
  const lb = (centre - margin) / denom;
  // Clamp to [0,1] — float dust can push an exact-0 or exact-1 proportion a hair outside the interval.
  return lb < 0 ? 0 : lb > 1 ? 1 : lb;
}

/** Absolute Wilson-LB floor (as a %): the alternative graduation path when the off-signal baseline is
 *  thin/absent. A 95% lower bound this high is a strong edge on its own — well above the ~33% breakeven
 *  and above the coin-flip 50%. Kept as an OR with the Δ-vs-baseline path so a bucket with no usable
 *  baseline can still graduate on an overwhelming, uncertainty-adjusted on-signal record. */
export const SWING_GRADUATION_WILSON_ABS_FLOOR = 60;

/** Float guard for the ">= 15 pts" / ">= floor" comparisons — mirrors the 0DTE module's DELTA_EPSILON:
 *  forgives IEEE754 dust on a mathematically-exact boundary, never a genuinely smaller value. */
const DELTA_EPSILON = 1e-9;
const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;

/** The staged verdict a bucket earns — surfaced on every wrapper alongside the reused 0DTE recommendation. */
export interface SwingStagedVerdict {
  /** Staged tier by graded on-signal sample count (drives enforcement ELIGIBILITY). */
  tier: SwingGraduationTier;
  /** Wilson score LOWER bound of the on-signal win rate, as a proportion in [0,1] (rounded). */
  wilsonLb: number;
  /** Raw point-estimate win-rate delta (on − off), percentage points — the 0DTE `recommendSignal` delta. */
  pointDelta: number | null;
  /** The reused 0DTE point-estimate verdict (enforce/keep_calibrating/insufficient_data). */
  verdict: SignalRecommendation["verdict"];
  /** The one true graduation flag: LIMITED/BROAD tier AND Wilson-LB gate passes AND point-Δ >= 15pt.
   *  FALSE at PROVISIONAL_SHADOW even when the raw verdict is "enforce" — n=10 shadows, never enforces. */
  graduated: boolean;
}

/**
 * The shared per-bucket graduation step: split already-graded rows into signal-ON / signal-OFF by a
 * documented binary, hand them to the reused `recommendSignal` ladder for the POINT-Δ (zero new
 * point-estimate math), then layer the swing-only STAGED tier + Wilson-LB uncertainty gate on top.
 * `noReadRows` are graded rows that carried no usable on/off signal for this bucket — counted, never
 * voted. THIS is the only place the ladder is invoked; every wrapper flows through it.
 */
function gradeBucket(
  signalName: string,
  onRows: SwingCalibrationRow[],
  offRows: SwingCalibrationRow[],
  noReadRows: SwingCalibrationRow[],
): { recommendation: SignalRecommendation; bucket: CalibrationBucket } & SwingStagedVerdict {
  const onPlay = toPlayRows(onRows);
  const offPlay = toPlayRows(offRows);
  const recommendation = recommendSignal(signalName, onPlay, offPlay, noReadRows.length);
  const bucket = bucketOf(signalName, [...onPlay, ...offPlay]);

  // Staged tier is driven by the ON-signal graded count — the same bucket ENFORCE_MIN_BLOCK_N gates on.
  const onBucket = bucketOf(signalName, onPlay);
  const tier = swingGraduationTier(onBucket.n);
  const wilsonLbRaw = wilsonLowerBound(onBucket.wins, onBucket.n);
  const wilsonLb = round4(wilsonLbRaw);

  // Wilson-LB gate (uncertainty-adjusted, NOT the raw point estimate): the on-signal lower bound must
  // either beat the off-signal POINT rate by ENFORCE_MIN_DELTA_PTS, or clear the absolute floor. Using
  // the LOWER bound is what stops a 10-of-10 (LB ~0.72) from clearing a bar its midpoint (1.0) would.
  const lbPct = wilsonLbRaw * 100;
  const offRate = rawWinRatePct(offPlay); // raw, unrounded off-signal win rate (null if no off rows)
  const wilsonBeatsOff = offRate != null && lbPct - offRate >= ENFORCE_MIN_DELTA_PTS - DELTA_EPSILON;
  const wilsonClearsFloor = lbPct >= SWING_GRADUATION_WILSON_ABS_FLOOR - DELTA_EPSILON;
  const wilsonPass = wilsonBeatsOff || wilsonClearsFloor;

  // Point-Δ gate = the reused 0DTE ladder's own "enforce" (n>=ENFORCE_MIN_BLOCK_N, baseline not low_n,
  // raw Δ>=ENFORCE_MIN_DELTA_PTS). graduated requires ALL THREE: enforcement-eligible tier, Wilson-LB, point-Δ.
  const pointGate = recommendation.verdict === "enforce";
  const graduated = tierEnforcementEligible(tier) && wilsonPass && pointGate;

  return {
    recommendation,
    bucket,
    tier,
    wilsonLb,
    pointDelta: recommendation.evidence.delta_win_rate_pts,
    verdict: recommendation.verdict,
    graduated,
  };
}

// ── 1. Per-archetype score-floor graduation (flips ARCHETYPE_META[a].scoreFloorGraduated) ──────────
// Signal = the committed score CLEARED the archetype's provisional floor. The floor earns enforcement
// when clearing it beats being below it by ≥15pt at n≥10 — i.e. the floor actually separates winners.
export interface SwingArchetypeGraduation extends SwingStagedVerdict {
  archetype: SwingArchetype;
  provisionalFloor: number;
  recommendation: SignalRecommendation;
  /** The ONE flag this bucket can flip: ARCHETYPE_META[archetype].scoreFloorGraduated. Equals the
   *  staged `graduated` (LIMITED/BROAD ∧ Wilson-LB ∧ Δ>=15) — NOT the raw verdict==="enforce". */
  floorGraduated: boolean;
  bucket: CalibrationBucket;
}

export function analyzeArchetypeRecord(rows: SwingCalibrationRow[]): SwingArchetypeGraduation[] {
  const graded = rows.filter(isGradedSwingRow);
  return SWING_ARCHETYPES.map((archetype) => {
    const floor = ARCHETYPE_META[archetype].scoreFloor;
    const inBucket = graded.filter((r) => r.archetype === archetype);
    const { on, off, noRead } = partitionByFloor(inBucket, floor);
    const staged = gradeBucket(`archetype_floor:${archetype}`, on, off, noRead);
    return { archetype, provisionalFloor: floor, floorGraduated: staged.graduated, ...staged };
  });
}

// ── 2. Per-sub-lane score-floor graduation (flips SWING_SUB_LANES[sl].scoreFloorGraduated) ──────────
export interface SwingSubLaneGraduation extends SwingStagedVerdict {
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
    const staged = gradeBucket(`sublane_floor:${subLane}`, on, off, noRead);
    return { subLane, provisionalFloor: floor, floorGraduated: staged.graduated, ...staged };
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
export interface SwingPillarWeightGraduation extends SwingStagedVerdict {
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
    const staged = gradeBucket(`pillar_weights:${archetype}`, on, base, []);
    return {
      archetype,
      weightsGraduated: staged.graduated,
      provisionalGraduated: SWING_PILLAR_WEIGHTS_GRADUATED,
      ...staged,
    };
  });
}

// ── 4. Exit-rung / scale-out graduation (flips each rung into manage.ts `graduatedRungs`) ───────────
// Signal-ON = the rung fired for this position; signal-OFF = it did not (held / other rung). A rung earns
// enforcement when the positions it acted on cleanly separate from the rest by ≥15pt at n≥10 — the exact
// evidence manage.ts waits on before it lets an edge rung stop counting as advisory.
export interface SwingRungGraduation extends SwingStagedVerdict {
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
    const staged = gradeBucket(`exit_rung:${rung}`, on, off, noRead);
    return { rung, rungGraduated: staged.graduated, ...staged };
  });
}

// ── 5. Edge-gate graduation (flips gates.ts reward_risk_floor / entry_extended enforced:false→true) ─
// A GATE earns enforcement when its would-BLOCK bucket UNDERperforms would-pass. recommendSignal enforces
// when signal-ON beats signal-OFF, so we pass ON = would_PASS, OFF = would_BLOCK: a ≥15pt pass-over-block
// win-rate edge at n≥10 (pass bucket) means the gate's block verdict is catching genuinely worse trades →
// enforce. Rows with no pinned verdict for the gate are no-read.
export interface SwingGateGraduation extends SwingStagedVerdict {
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
    const staged = gradeBucket(`edge_gate:${gate}`, wouldPass, wouldBlock, noRead);
    return { gate, enforced: staged.graduated, ...staged };
  });
}

// ── 6. Contract-rank-weight graduation (flips SWING_CONTRACT_RANK_GRADUATED) ────────────────────────
// Signal-ON = the played contract scored in the ranker's TOP tier (its weighted tradability×thesisFit put
// it at the front); signal-OFF = a lower-tier fill. The rank BLEND earns enforcement (sizes/gates) when
// top-tier picks beat lower-tier ones by ≥15pt at n≥10 — the evidence that the weighted ordering, not just
// the mechanical eligibility filter, is predictive. One global flag (the blend is archetype-agnostic).
export interface SwingContractRankGraduation extends SwingStagedVerdict {
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
  const staged = gradeBucket("contract_rank_top_tier", on, off, noRead);
  return {
    rankGraduated: staged.graduated,
    provisionalGraduated: SWING_CONTRACT_RANK_GRADUATED,
    ...staged,
  };
}

// ── 7. Allocation budget-cap graduation (flips swing-allocation.ts enforce:false→true) ─────────────
// Signal-ON = positions taken WITHIN the caps (no cap flag tripped); signal-OFF = positions taken while
// breaching a cap (the over-concentrated / over-weight ones the advisory sizing would have SKIPPED). The
// caps earn enforcement when within-cap positions beat cap-breaching ones by ≥15pt at n≥10 — the evidence
// that respecting the budget actually protects the book. One global flag (the whole cap set enforces together).
export interface SwingAllocationGraduation extends SwingStagedVerdict {
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
  const staged = gradeBucket("allocation_within_cap", withinCap, breachedCap, noRead);
  return { capsEnforced: staged.graduated, ...staged };
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
  "rung, contract-rank blend, allocation caps — stays provisional and graduates on a STAGED ladder harsher " +
  "than 0DTE's binary bar: n<10 RESEARCH, n=10–29 PROVISIONAL_SHADOW (would-enforce log, NEVER enforces), " +
  "n=30–74 LIMITED, n>=75 BROAD. A bucket only graduates in LIMITED/BROAD AND when the WILSON score lower " +
  "bound of its on-signal win rate (not the raw point estimate — guards small-sample flukes) beats the " +
  "off-signal rate by >=15pt or clears an absolute floor, AND the reused 0DTE recommendSignal point-Δ still " +
  ">=15pt. Exactly one flag flips per graduated bucket. Non-gating: the report is the evidence bar, the " +
  "live flip is a human/PR write.";

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
