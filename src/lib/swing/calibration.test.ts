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

// ── 1. archetype floor: the three graduation ladder rungs ────────────────────────────────────────
test("archetype floor — bucket below n=10 stays provisional (insufficient_data, flag false)", () => {
  const floor = ARCHETYPE_META.BREAKOUT.scoreFloor;
  // 9 clear-floor winners + 5 below-floor losers: signal_on n=9 < 10 → insufficient_data.
  const input = [
    ...rows(9, 9, { archetype: "BREAKOUT", score: floor + 5 }),
    ...rows(5, 0, { archetype: "BREAKOUT", score: floor - 5 }),
  ];
  const brk = analyzeArchetypeRecord(input).find((r) => r.archetype === "BREAKOUT")!;
  assert.equal(brk.recommendation.verdict, "insufficient_data");
  assert.equal(brk.floorGraduated, false);
});

test("archetype floor — clearing n>=10 AND delta>=15pt flips EXACTLY this floor to enforce", () => {
  const floor = ARCHETYPE_META.BREAKOUT.scoreFloor;
  // signal_on n=10 @ 100% WR; signal_off n=6 @ 0% WR → delta 100pt ≥ 15 → enforce.
  const input = [
    ...rows(10, 10, { archetype: "BREAKOUT", score: floor + 5 }),
    ...rows(6, 0, { archetype: "BREAKOUT", score: floor - 5 }),
  ];
  const all = analyzeArchetypeRecord(input);
  const brk = all.find((r) => r.archetype === "BREAKOUT")!;
  assert.equal(brk.recommendation.verdict, "enforce");
  assert.equal(brk.floorGraduated, true);
  // ONE flag per bucket: no OTHER archetype graduated off BREAKOUT's rows.
  assert.equal(all.filter((r) => r.floorGraduated).length, 1);
});

test("archetype bucketing keys off the PRIMARY archetype ONLY — secondary metadata never shifts a bucket", () => {
  // Persisting the full classification metadata (secondary[]/archetype_scores{}/classification_margin) must be
  // pure capture: calibration partitions solely on `archetype` (the primary). Here a BREAKOUT row ALSO carries
  // near-tie secondary metadata pointing at EVENT_DRIVEN; if any of it leaked into bucketing it would move the
  // row out of BREAKOUT. It must not — so the BREAKOUT bucket counts BOTH rows, EVENT_DRIVEN counts zero of them.
  const floor = ARCHETYPE_META.BREAKOUT.scoreFloor;
  const withSecondaryMeta = {
    archetype: "BREAKOUT" as const,
    score: floor + 5,
    // Extra keys the calibration row type doesn't model — proving they're structurally invisible to bucketing.
    secondary: ["EVENT_DRIVEN"],
    archetype_scores: { BREAKOUT: 0.8, EVENT_DRIVEN: 0.79 },
    classification_margin: 0.01,
  } as unknown as Partial<SwingCalibrationRow>;
  const input = [
    ...rows(1, 1, { archetype: "BREAKOUT", score: floor + 5 }),
    ...rows(1, 0, withSecondaryMeta),
    ...rows(1, 1, { archetype: "EVENT_DRIVEN", score: floor + 5 }),
  ];
  const all = analyzeArchetypeRecord(input);
  const brk = all.find((r) => r.archetype === "BREAKOUT")!;
  const evt = all.find((r) => r.archetype === "EVENT_DRIVEN")!;
  assert.equal(brk.bucket.n, 2); // both BREAKOUT rows, incl. the near-tie one, stay in BREAKOUT
  assert.equal(evt.bucket.n, 1); // the secondary=EVENT_DRIVEN metadata did NOT pull a row into EVENT_DRIVEN
});

test("archetype floor — n>=10 but delta<15pt keeps calibrating (provisional)", () => {
  const floor = ARCHETYPE_META.PULLBACK_CONTINUATION.scoreFloor;
  // on n=10 @ 60% WR; off n=10 @ 50% WR → delta 10pt < 15 → keep_calibrating.
  const input = [
    ...rows(10, 6, { archetype: "PULLBACK_CONTINUATION", score: floor + 5 }),
    ...rows(10, 5, { archetype: "PULLBACK_CONTINUATION", score: floor - 5 }),
  ];
  const pb = analyzeArchetypeRecord(input).find((r) => r.archetype === "PULLBACK_CONTINUATION")!;
  assert.equal(pb.recommendation.verdict, "keep_calibrating");
  assert.equal(pb.floorGraduated, false);
});

test("archetype floor — always returns all 8 archetypes; empty input → all insufficient_data/false", () => {
  const all = analyzeArchetypeRecord([]);
  assert.equal(all.length, 8);
  assert.ok(all.every((r) => r.recommendation.verdict === "insufficient_data" && r.floorGraduated === false));
});

// ── 2. sub-lane floor ────────────────────────────────────────────────────────────────────────
test("sub-lane floor — clears the bar → exactly one sub-lane floor enforces", () => {
  const floor = SWING_SUB_LANES.STANDARD.scoreFloor;
  const input = [
    ...rows(10, 10, { sub_lane: "STANDARD", score: floor + 5 }),
    ...rows(6, 0, { sub_lane: "STANDARD", score: floor - 5 }),
  ];
  const res = analyzeSubLaneRecord(input);
  assert.equal(res.length, 3);
  const std = res.find((r) => r.subLane === "STANDARD")!;
  assert.equal(std.recommendation.verdict, "enforce");
  assert.equal(std.floorGraduated, true);
  assert.equal(res.filter((r) => r.floorGraduated).length, 1);
});

test("sub-lane floor — below n=10 stays provisional", () => {
  const floor = SWING_SUB_LANES.TACTICAL.scoreFloor;
  const input = [
    ...rows(8, 8, { sub_lane: "TACTICAL", score: floor + 5 }),
    ...rows(6, 0, { sub_lane: "TACTICAL", score: floor - 5 }),
  ];
  const tac = analyzeSubLaneRecord(input).find((r) => r.subLane === "TACTICAL")!;
  assert.equal(tac.recommendation.verdict, "insufficient_data");
  assert.equal(tac.floorGraduated, false);
});

// ── 3. pillar weights ────────────────────────────────────────────────────────────────────────
test("pillar weights — archetype vector beats the base baseline by >=15pt → weightsGraduated", () => {
  const input = [
    ...rows(10, 10, { archetype: "FLOW_ACCUMULATION" }), // signal_on: 100% WR
    ...rows(6, 0, { archetype: null }), // base baseline: 0% WR
  ];
  const fa = analyzePillarWeightRecord(input).find((r) => r.archetype === "FLOW_ACCUMULATION")!;
  assert.equal(fa.recommendation.verdict, "enforce");
  assert.equal(fa.weightsGraduated, true);
  assert.equal(fa.provisionalGraduated, false);
});

// ── 4. exit rungs ──────────────────────────────────────────────────────────────────────────────
test("exit rung — a rung whose bucket clears the bar graduates alone", () => {
  const input = [
    ...rows(10, 10, { manage_rung: "profit_ladder" }),
    ...rows(6, 0, { manage_rung: "time_stop" }),
  ];
  const res = analyzeSwingScaleOut(input);
  assert.equal(res.length, SWING_EDGE_RUNGS.length);
  const ladder = res.find((r) => r.rung === "profit_ladder")!;
  assert.equal(ladder.recommendation.verdict, "enforce");
  assert.equal(ladder.rungGraduated, true);
  // Only profit_ladder graduates — time_stop is the OFF pool here (0% WR), never flips true.
  assert.equal(res.filter((r) => r.rungGraduated).length, 1);
});

// ── 5. edge gates (block-underperforms mapping) ──────────────────────────────────────────────────
test("edge gate — would_block bucket underperforms would_pass by >=15pt → gate enforces", () => {
  // would_pass (verdict=false) win; would_block (verdict=true) lose.
  const input = [
    ...rows(10, 10, { gate_verdicts: { reward_risk_floor: false } }), // would_pass, 100% WR
    ...rows(6, 0, { gate_verdicts: { reward_risk_floor: true } }), // would_block, 0% WR
  ];
  const res = analyzeSwingGateCalibration(input);
  assert.equal(res.length, SWING_EDGE_GATES.length);
  const rr = res.find((r) => r.gate === "reward_risk_floor")!;
  assert.equal(rr.recommendation.verdict, "enforce");
  assert.equal(rr.enforced, true);
  // entry_extended saw no verdicts → insufficient_data, not enforced.
  const ee = res.find((r) => r.gate === "entry_extended")!;
  assert.equal(ee.enforced, false);
  assert.equal(res.filter((r) => r.enforced).length, 1);
});

test("edge gate — block NOT worse than pass (delta<15pt) keeps calibrating", () => {
  const input = [
    ...rows(10, 6, { gate_verdicts: { entry_extended: false } }), // pass 60%
    ...rows(10, 5, { gate_verdicts: { entry_extended: true } }), // block 50%
  ];
  const ee = analyzeSwingGateCalibration(input).find((r) => r.gate === "entry_extended")!;
  assert.equal(ee.recommendation.verdict, "keep_calibrating");
  assert.equal(ee.enforced, false);
});

// ── 6. contract rank ────────────────────────────────────────────────────────────────────────
test("contract rank — top-tier picks beat lower-tier by >=15pt → rankGraduated", () => {
  const input = [
    ...rows(10, 10, { contract_rank_top: true }),
    ...rows(6, 0, { contract_rank_top: false }),
  ];
  const res = analyzeContractRankCalibration(input);
  assert.equal(res.recommendation.verdict, "enforce");
  assert.equal(res.rankGraduated, true);
  assert.equal(res.provisionalGraduated, false);
});

test("contract rank — below n=10 top-tier stays provisional", () => {
  const input = [...rows(9, 9, { contract_rank_top: true }), ...rows(6, 0, { contract_rank_top: false })];
  const res = analyzeContractRankCalibration(input);
  assert.equal(res.recommendation.verdict, "insufficient_data");
  assert.equal(res.rankGraduated, false);
});

// ── 7. allocation caps ────────────────────────────────────────────────────────────────────────
test("allocation caps — within-cap beats cap-breaching by >=15pt → capsEnforced", () => {
  const input = [
    ...rows(10, 10, { allocation_breached_cap: false }),
    ...rows(6, 0, { allocation_breached_cap: true }),
  ];
  const res = analyzeAllocationRecord(input);
  assert.equal(res.recommendation.verdict, "enforce");
  assert.equal(res.capsEnforced, true);
});

test("allocation caps — within-cap not enough better (delta<15pt) keeps calibrating", () => {
  const input = [
    ...rows(10, 6, { allocation_breached_cap: false }),
    ...rows(10, 5, { allocation_breached_cap: true }),
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

test("analyzeSwingCalibration — one graduating bucket flips exactly one flag across the whole report", () => {
  const floor = ARCHETYPE_META.SECTOR_ROTATION.scoreFloor;
  const rep = analyzeSwingCalibration([
    ...rows(10, 10, { archetype: "SECTOR_ROTATION", score: floor + 5 }),
    ...rows(6, 0, { archetype: "SECTOR_ROTATION", score: floor - 5 }),
  ]);
  assert.equal(rep.available, true);
  // Exactly one archetype floor graduated; no sub-lane/gate/rung/rank/cap flipped (no pinned keys for them).
  assert.equal(rep.archetype_floors.filter((r) => r.floorGraduated).length, 1);
  assert.equal(rep.sub_lane_floors.filter((r) => r.floorGraduated).length, 0);
  assert.equal(rep.edge_gates.filter((r) => r.enforced).length, 0);
  assert.equal(rep.exit_rungs.filter((r) => r.rungGraduated).length, 0);
});
