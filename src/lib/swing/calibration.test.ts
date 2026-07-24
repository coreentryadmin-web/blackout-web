import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeArchetypeRecord,
  analyzeSubLaneRecord,
  analyzePillarWeightRecord,
  analyzeSwingScaleOut,
  analyzeSwingGateCalibration,
  analyzeContractRankCalibration,
  analyzeAllocationRecord,
  analyzeSwingCalibration,
  isGradedSwingRow,
  swingGraduationTier,
  wilsonLowerBound,
  SWING_GRADUATION_TIERS,
  SWING_EDGE_GATES,
  SWING_EDGE_RUNGS,
  type SwingCalibrationRow,
} from "./calibration.ts";
import { ARCHETYPE_META, SWING_SUB_LANES } from "./taxonomy.ts";

// ── fixture builders ───────────────────────────────────────────────────────────────────────────
// A graded row: grade stamp + finite realized P&L. `win` sets realized to +10% (win) or −20% (loss).
const row = (win: boolean, extra: Partial<SwingCalibrationRow> = {}): SwingCalibrationRow => ({
  realized_pnl_pct: win ? 10 : -20,
  graded_at: "2026-07-01T00:00:00Z",
  ...extra,
});
/** N rows, `wins` of them winners. */
const rows = (n: number, wins: number, extra: Partial<SwingCalibrationRow> = {}): SwingCalibrationRow[] =>
  Array.from({ length: n }, (_, i) => row(i < wins, extra));

// ── graded gate ──────────────────────────────────────────────────────────────────────────────
test("isGradedSwingRow requires BOTH a grade stamp and a finite realized P&L", () => {
  assert.equal(isGradedSwingRow({ realized_pnl_pct: 10, graded_at: "x" }), true);
  assert.equal(isGradedSwingRow({ realized_pnl_pct: 10, graded_at: null }), false);
  assert.equal(isGradedSwingRow({ realized_pnl_pct: null, graded_at: "x" }), false);
  assert.equal(isGradedSwingRow({ realized_pnl_pct: Number.NaN, graded_at: "x" }), false);
});

// ── STAGED ladder: swingGraduationTier boundaries ─────────────────────────────────────────────────
test("swingGraduationTier — the four rungs at their exact boundaries (9/10/29/30/74/75)", () => {
  assert.equal(swingGraduationTier(0), "RESEARCH");
  assert.equal(swingGraduationTier(9), "RESEARCH");
  assert.equal(swingGraduationTier(10), "PROVISIONAL_SHADOW");
  assert.equal(swingGraduationTier(29), "PROVISIONAL_SHADOW");
  assert.equal(swingGraduationTier(30), "LIMITED");
  assert.equal(swingGraduationTier(74), "LIMITED");
  assert.equal(swingGraduationTier(75), "BROAD");
  assert.equal(swingGraduationTier(1000), "BROAD");
  // Defensive: negative / non-finite clamp to RESEARCH.
  assert.equal(swingGraduationTier(-5), "RESEARCH");
  assert.equal(swingGraduationTier(Number.NaN), "RESEARCH");
});

test("SWING_GRADUATION_TIERS — only LIMITED/BROAD are enforcement-eligible; SHADOW/RESEARCH never", () => {
  const eligible = SWING_GRADUATION_TIERS.filter((t) => t.enforcementEligible).map((t) => t.tier);
  assert.deepEqual(eligible.sort(), ["BROAD", "LIMITED"]);
  const shadow = SWING_GRADUATION_TIERS.find((t) => t.tier === "PROVISIONAL_SHADOW")!;
  assert.equal(shadow.enforcementEligible, false);
});

// ── Uncertainty bound: Wilson score lower bound ─────────────────────────────────────────────────
test("wilsonLowerBound — 10/10 is NOT 1.0; the lower bound sits well below the point estimate", () => {
  const lb = wilsonLowerBound(10, 10);
  assert.notEqual(lb, 1);
  assert.ok(lb < 0.75, `10/10 Wilson-LB should be well under 1.0, got ${lb}`);
  assert.ok(Math.abs(lb - 0.7225) < 0.001, `expected ~0.7225, got ${lb}`);
});

test("wilsonLowerBound — known midpoint values + degenerate n", () => {
  // 50/100 → ~0.4038 (below the 0.5 point estimate, above 0.4).
  const lb = wilsonLowerBound(50, 100);
  assert.ok(lb > 0.4 && lb < 0.41, `expected ~0.4038, got ${lb}`);
  // More samples at the same rate → a TIGHTER (higher) lower bound: 100/100 > 10/10.
  assert.ok(wilsonLowerBound(100, 100) > wilsonLowerBound(10, 10));
  // No evidence → no lower bound.
  assert.equal(wilsonLowerBound(0, 0), 0);
  // 0 wins → LB clamped to >= 0, never negative.
  assert.ok(wilsonLowerBound(0, 30) >= 0);
});

// ── 1. archetype floor: staged ladder + Wilson-LB in force ────────────────────────────────────────
test("archetype floor — bucket below n=10 → RESEARCH tier, insufficient_data, not graduated", () => {
  const floor = ARCHETYPE_META.BREAKOUT.scoreFloor;
  const input = [
    ...rows(9, 9, { archetype: "BREAKOUT", score: floor + 5 }),
    ...rows(5, 0, { archetype: "BREAKOUT", score: floor - 5 }),
  ];
  const brk = analyzeArchetypeRecord(input).find((r) => r.archetype === "BREAKOUT")!;
  assert.equal(brk.tier, "RESEARCH");
  assert.equal(brk.recommendation.verdict, "insufficient_data");
  assert.equal(brk.graduated, false);
  assert.equal(brk.floorGraduated, false);
});

test("archetype floor — REGRESSION CLOSED: 10-of-10 is PROVISIONAL_SHADOW, graduated:false (was enforce/true)", () => {
  const floor = ARCHETYPE_META.BREAKOUT.scoreFloor;
  // signal_on n=10 @ 100% WR; signal_off n=6 @ 0% WR → raw point-Δ 100pt, raw verdict "enforce"…
  const input = [
    ...rows(10, 10, { archetype: "BREAKOUT", score: floor + 5 }),
    ...rows(6, 0, { archetype: "BREAKOUT", score: floor - 5 }),
  ];
  const all = analyzeArchetypeRecord(input);
  const brk = all.find((r) => r.archetype === "BREAKOUT")!;
  // …but the STAGED ladder holds it at PROVISIONAL_SHADOW → NEVER graduates at n=10 anymore.
  assert.equal(brk.tier, "PROVISIONAL_SHADOW");
  assert.equal(brk.verdict, "enforce"); // the raw point-estimate verdict is still surfaced…
  assert.equal(brk.graduated, false); // …but graduated is FALSE (shadow, not enforce).
  assert.equal(brk.floorGraduated, false);
  // Nothing graduates off n=10 anywhere in the archetype record.
  assert.equal(all.filter((r) => r.floorGraduated).length, 0);
});

test("archetype floor — 45-of-60 with a wide off gap AND Wilson-LB passing → LIMITED, graduated:true", () => {
  const floor = ARCHETYPE_META.BREAKOUT.scoreFloor;
  // on n=60 @ 75% WR (Wilson-LB ~0.628); off n=10 @ 30% WR → LB beats off by ~32pt and clears the 60% floor.
  const input = [
    ...rows(60, 45, { archetype: "BREAKOUT", score: floor + 5 }),
    ...rows(10, 3, { archetype: "BREAKOUT", score: floor - 5 }),
  ];
  const all = analyzeArchetypeRecord(input);
  const brk = all.find((r) => r.archetype === "BREAKOUT")!;
  assert.equal(brk.tier, "LIMITED");
  assert.equal(brk.verdict, "enforce");
  assert.ok(brk.wilsonLb > 0.6, `Wilson-LB should clear the abs floor, got ${brk.wilsonLb}`);
  assert.equal(brk.graduated, true);
  assert.equal(brk.floorGraduated, true);
  // ONE flag per bucket: no OTHER archetype graduated off BREAKOUT's rows.
  assert.equal(all.filter((r) => r.floorGraduated).length, 1);
});

test("archetype floor — n=30 whose Wilson-LB does NOT clear → LIMITED tier but NOT graduated", () => {
  const floor = ARCHETYPE_META.PULLBACK_CONTINUATION.scoreFloor;
  // on n=30 @ 60% WR (point-Δ 20pt vs off 40% → raw verdict "enforce", tier LIMITED)…
  const input = [
    ...rows(30, 18, { archetype: "PULLBACK_CONTINUATION", score: floor + 5 }),
    ...rows(10, 4, { archetype: "PULLBACK_CONTINUATION", score: floor - 5 }),
  ];
  const pb = analyzeArchetypeRecord(input).find((r) => r.archetype === "PULLBACK_CONTINUATION")!;
  assert.equal(pb.tier, "LIMITED");
  assert.equal(pb.verdict, "enforce"); // the raw point estimate would enforce…
  // …but the Wilson-LB (~0.423) neither beats off (40%) by 15pt nor clears the 60% floor → NOT graduated.
  assert.ok(pb.wilsonLb < 0.5, `Wilson-LB should be well under the floor, got ${pb.wilsonLb}`);
  assert.equal(pb.graduated, false);
  assert.equal(pb.floorGraduated, false);
});

test("archetype floor — n>=30 but point-Δ<15pt keeps calibrating (provisional)", () => {
  const floor = ARCHETYPE_META.SECTOR_ROTATION.scoreFloor;
  // on n=40 @ 60% WR; off n=40 @ 50% WR → point-Δ 10pt < 15 → keep_calibrating, never graduated.
  const input = [
    ...rows(40, 24, { archetype: "SECTOR_ROTATION", score: floor + 5 }),
    ...rows(40, 20, { archetype: "SECTOR_ROTATION", score: floor - 5 }),
  ];
  const sr = analyzeArchetypeRecord(input).find((r) => r.archetype === "SECTOR_ROTATION")!;
  assert.equal(sr.tier, "LIMITED");
  assert.equal(sr.recommendation.verdict, "keep_calibrating");
  assert.equal(sr.graduated, false);
  assert.equal(sr.floorGraduated, false);
});

test("archetype floor — always returns all 8 archetypes; empty input → all RESEARCH/false", () => {
  const all = analyzeArchetypeRecord([]);
  assert.equal(all.length, 8);
  assert.ok(
    all.every(
      (r) => r.tier === "RESEARCH" && r.recommendation.verdict === "insufficient_data" && r.floorGraduated === false,
    ),
  );
});

// ── 2. sub-lane floor ────────────────────────────────────────────────────────────────────────
test("sub-lane floor — clears the STAGED bar (n>=30 + Wilson-LB) → exactly one sub-lane floor graduates", () => {
  const floor = SWING_SUB_LANES.STANDARD.scoreFloor;
  const input = [
    ...rows(60, 45, { sub_lane: "STANDARD", score: floor + 5 }),
    ...rows(10, 3, { sub_lane: "STANDARD", score: floor - 5 }),
  ];
  const res = analyzeSubLaneRecord(input);
  assert.equal(res.length, 3);
  const std = res.find((r) => r.subLane === "STANDARD")!;
  assert.equal(std.tier, "LIMITED");
  assert.equal(std.graduated, true);
  assert.equal(std.floorGraduated, true);
  assert.equal(res.filter((r) => r.floorGraduated).length, 1);
});

test("sub-lane floor — 10-of-10 stays PROVISIONAL_SHADOW (graduated:false)", () => {
  const floor = SWING_SUB_LANES.TACTICAL.scoreFloor;
  const input = [
    ...rows(10, 10, { sub_lane: "TACTICAL", score: floor + 5 }),
    ...rows(6, 0, { sub_lane: "TACTICAL", score: floor - 5 }),
  ];
  const tac = analyzeSubLaneRecord(input).find((r) => r.subLane === "TACTICAL")!;
  assert.equal(tac.tier, "PROVISIONAL_SHADOW");
  assert.equal(tac.floorGraduated, false);
});

// ── 3. pillar weights ────────────────────────────────────────────────────────────────────────
test("pillar weights — archetype vector beats base baseline, n>=30 + Wilson-LB → weightsGraduated", () => {
  const input = [
    ...rows(60, 45, { archetype: "FLOW_ACCUMULATION" }), // signal_on: 75% WR, Wilson-LB clears floor
    ...rows(10, 3, { archetype: null }), // base baseline: 30% WR
  ];
  const fa = analyzePillarWeightRecord(input).find((r) => r.archetype === "FLOW_ACCUMULATION")!;
  assert.equal(fa.tier, "LIMITED");
  assert.equal(fa.weightsGraduated, true);
  assert.equal(fa.provisionalGraduated, false);
});

test("pillar weights — n=10 vector run does NOT graduate (PROVISIONAL_SHADOW)", () => {
  const input = [
    ...rows(10, 10, { archetype: "FLOW_ACCUMULATION" }),
    ...rows(6, 0, { archetype: null }),
  ];
  const fa = analyzePillarWeightRecord(input).find((r) => r.archetype === "FLOW_ACCUMULATION")!;
  assert.equal(fa.tier, "PROVISIONAL_SHADOW");
  assert.equal(fa.weightsGraduated, false);
});

// ── 4. exit rungs ──────────────────────────────────────────────────────────────────────────────
test("exit rung — a rung whose bucket clears the staged bar graduates alone", () => {
  const input = [
    ...rows(60, 45, { manage_rung: "profit_ladder" }),
    ...rows(10, 3, { manage_rung: "time_stop" }),
  ];
  const res = analyzeSwingScaleOut(input);
  assert.equal(res.length, SWING_EDGE_RUNGS.length);
  const ladder = res.find((r) => r.rung === "profit_ladder")!;
  assert.equal(ladder.tier, "LIMITED");
  assert.equal(ladder.rungGraduated, true);
  assert.equal(res.filter((r) => r.rungGraduated).length, 1);
});

// ── 5. edge gates (block-underperforms mapping) ──────────────────────────────────────────────────
test("edge gate — would_block underperforms would_pass, n>=30 + Wilson-LB → gate enforces", () => {
  const input = [
    ...rows(60, 45, { gate_verdicts: { reward_risk_floor: false } }), // would_pass, 75% WR
    ...rows(10, 3, { gate_verdicts: { reward_risk_floor: true } }), // would_block, 30% WR
  ];
  const res = analyzeSwingGateCalibration(input);
  assert.equal(res.length, SWING_EDGE_GATES.length);
  const rr = res.find((r) => r.gate === "reward_risk_floor")!;
  assert.equal(rr.tier, "LIMITED");
  assert.equal(rr.enforced, true);
  const ee = res.find((r) => r.gate === "entry_extended")!;
  assert.equal(ee.enforced, false);
  assert.equal(res.filter((r) => r.enforced).length, 1);
});

test("edge gate — 10-of-10 pass-over-block stays PROVISIONAL_SHADOW (not enforced)", () => {
  const input = [
    ...rows(10, 10, { gate_verdicts: { reward_risk_floor: false } }),
    ...rows(6, 0, { gate_verdicts: { reward_risk_floor: true } }),
  ];
  const rr = analyzeSwingGateCalibration(input).find((r) => r.gate === "reward_risk_floor")!;
  assert.equal(rr.tier, "PROVISIONAL_SHADOW");
  assert.equal(rr.enforced, false);
});

test("edge gate — block NOT worse than pass (point-Δ<15pt) keeps calibrating", () => {
  const input = [
    ...rows(40, 24, { gate_verdicts: { entry_extended: false } }), // pass 60%
    ...rows(40, 20, { gate_verdicts: { entry_extended: true } }), // block 50%
  ];
  const ee = analyzeSwingGateCalibration(input).find((r) => r.gate === "entry_extended")!;
  assert.equal(ee.recommendation.verdict, "keep_calibrating");
  assert.equal(ee.enforced, false);
});

// ── 6. contract rank ────────────────────────────────────────────────────────────────────────
test("contract rank — top-tier beats lower-tier, n>=30 + Wilson-LB → rankGraduated", () => {
  const input = [
    ...rows(60, 45, { contract_rank_top: true }),
    ...rows(10, 3, { contract_rank_top: false }),
  ];
  const res = analyzeContractRankCalibration(input);
  assert.equal(res.tier, "LIMITED");
  assert.equal(res.rankGraduated, true);
  assert.equal(res.provisionalGraduated, false);
});

test("contract rank — 10-of-10 top-tier stays PROVISIONAL_SHADOW", () => {
  const input = [...rows(10, 10, { contract_rank_top: true }), ...rows(6, 0, { contract_rank_top: false })];
  const res = analyzeContractRankCalibration(input);
  assert.equal(res.tier, "PROVISIONAL_SHADOW");
  assert.equal(res.rankGraduated, false);
});

// ── 7. allocation caps ────────────────────────────────────────────────────────────────────────
test("allocation caps — within-cap beats cap-breaching, n>=30 + Wilson-LB → capsEnforced", () => {
  const input = [
    ...rows(60, 45, { allocation_breached_cap: false }),
    ...rows(10, 3, { allocation_breached_cap: true }),
  ];
  const res = analyzeAllocationRecord(input);
  assert.equal(res.tier, "LIMITED");
  assert.equal(res.capsEnforced, true);
});

test("allocation caps — within-cap not enough better (point-Δ<15pt) keeps calibrating", () => {
  const input = [
    ...rows(40, 24, { allocation_breached_cap: false }),
    ...rows(40, 20, { allocation_breached_cap: true }),
  ];
  const res = analyzeAllocationRecord(input);
  assert.equal(res.recommendation.verdict, "keep_calibrating");
  assert.equal(res.capsEnforced, false);
});

// ── whole-lane report ──────────────────────────────────────────────────────────────────────────
test("analyzeSwingCalibration — nothing graduates off an empty ledger; all provisional", () => {
  const rep = analyzeSwingCalibration([]);
  assert.equal(rep.available, false);
  assert.equal(rep.graded_plays, 0);
  assert.equal(rep.archetype_floors.filter((r) => r.floorGraduated).length, 0);
  assert.equal(rep.sub_lane_floors.filter((r) => r.floorGraduated).length, 0);
  assert.equal(rep.pillar_weights.filter((r) => r.weightsGraduated).length, 0);
  assert.equal(rep.exit_rungs.filter((r) => r.rungGraduated).length, 0);
  assert.equal(rep.edge_gates.filter((r) => r.enforced).length, 0);
  assert.equal(rep.contract_rank.rankGraduated, false);
  assert.equal(rep.allocation.capsEnforced, false);
});

test("analyzeSwingCalibration — a 10-of-10 archetype bucket graduates NOTHING (shadow only)", () => {
  const floor = ARCHETYPE_META.SECTOR_ROTATION.scoreFloor;
  const rep = analyzeSwingCalibration([
    ...rows(10, 10, { archetype: "SECTOR_ROTATION", score: floor + 5 }),
    ...rows(6, 0, { archetype: "SECTOR_ROTATION", score: floor - 5 }),
  ]);
  assert.equal(rep.available, true);
  assert.equal(rep.archetype_floors.filter((r) => r.floorGraduated).length, 0);
  const sr = rep.archetype_floors.find((r) => r.archetype === "SECTOR_ROTATION")!;
  assert.equal(sr.tier, "PROVISIONAL_SHADOW");
});

test("analyzeSwingCalibration — a fully-cleared bucket (n>=30 + Wilson-LB) flips exactly one flag", () => {
  const floor = ARCHETYPE_META.SECTOR_ROTATION.scoreFloor;
  const rep = analyzeSwingCalibration([
    ...rows(60, 45, { archetype: "SECTOR_ROTATION", score: floor + 5 }),
    ...rows(10, 3, { archetype: "SECTOR_ROTATION", score: floor - 5 }),
  ]);
  assert.equal(rep.available, true);
  assert.equal(rep.archetype_floors.filter((r) => r.floorGraduated).length, 1);
  assert.equal(rep.sub_lane_floors.filter((r) => r.floorGraduated).length, 0);
  assert.equal(rep.edge_gates.filter((r) => r.enforced).length, 0);
  assert.equal(rep.exit_rungs.filter((r) => r.rungGraduated).length, 0);
});
