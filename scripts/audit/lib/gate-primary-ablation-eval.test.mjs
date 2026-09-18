import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GATE_CODE_FAMILIES,
  wilsonIntervalPct,
  assumedPlanPayoffEvPct,
  aggregateBlockedForGate,
  evaluateGatePrimaryAblation,
  evaluateAllGatesPrimaryAblation,
  platformWideSkipGradingHealth,
} from "./gate-primary-ablation-eval.mjs";

function line(gate_failed, overrides = {}) {
  return {
    gate_failed,
    n: 0,
    ungradeable: 0,
    would_have_won: 0,
    would_have_won_rate_pct: null,
    by_basis: { premium: 0, underlying: 0 },
    low_n: true,
    ungradeable_reasons: [],
    ...overrides,
  };
}

test("wilsonIntervalPct matches the pinned reference check (k=8, n=10, z=1.96)", () => {
  const ci = wilsonIntervalPct(8, 10);
  assert.ok(Math.abs(ci.lo - 49.0) < 0.5, `lo=${ci.lo}`);
  assert.ok(Math.abs(ci.hi - 94.3) < 0.5, `hi=${ci.hi}`);
});

test("wilsonIntervalPct at n=0 returns nulls, never a fabricated interval", () => {
  const ci = wilsonIntervalPct(0, 0);
  assert.equal(ci.lo, null);
  assert.equal(ci.hi, null);
  assert.equal(ci.mid, null);
});

test("assumedPlanPayoffEvPct: 33.3% WR (near the -50/+100 breakeven) is ~breakeven", () => {
  // (1/3)*100 + (2/3)*(-50) = 33.33 - 33.33 = 0
  const ev = assumedPlanPayoffEvPct(33.3333);
  assert.ok(Math.abs(ev - 0) < 0.5, `ev=${ev}`);
});

test("assumedPlanPayoffEvPct: 100% WR -> +100, 0% WR -> -50 (payoff extremes)", () => {
  assert.equal(assumedPlanPayoffEvPct(100), 100);
  assert.equal(assumedPlanPayoffEvPct(0), -50);
});

test("assumedPlanPayoffEvPct: null win rate (no graded rows) -> null, never a fabricated number", () => {
  assert.equal(assumedPlanPayoffEvPct(null), null);
  assert.equal(assumedPlanPayoffEvPct(undefined), null);
  assert.equal(assumedPlanPayoffEvPct(NaN), null);
});

test("aggregateBlockedForGate: G-10's empty code list is NOT_MEASURABLE regardless of what lines exist", () => {
  // Even if some OTHER gate's lines are present, an empty codes array must never match them.
  const lines = [line("tape_alignment", { n: 20, would_have_won: 10 })];
  const agg = aggregateBlockedForGate(lines, []);
  assert.equal(agg.measurable, false);
  assert.equal(agg.n, 0);
  assert.match(agg.reason, /score-only|non-blocking/);
});

test("aggregateBlockedForGate: merges multiple codes belonging to the same logical gate (G-1)", () => {
  const lines = [
    line("no_market_bias", { n: 6, would_have_won: 2, ungradeable: 1, by_basis: { premium: 0, underlying: 6 } }),
    line("tape_alignment", { n: 14, would_have_won: 9, ungradeable: 3, by_basis: { premium: 0, underlying: 14 } }),
    // A different gate's code must NOT bleed into G-1's aggregate.
    line("confluence_floor", { n: 999, would_have_won: 999 }),
  ];
  const agg = aggregateBlockedForGate(lines, GATE_CODE_FAMILIES["G-1"].codes);
  assert.equal(agg.measurable, true);
  assert.equal(agg.n, 20);
  assert.equal(agg.wins, 11);
  assert.equal(agg.ungradeable, 4);
  assert.equal(agg.win_rate_pct, 55); // 11/20
  assert.equal(agg.by_basis.underlying, 20);
  assert.deepEqual(agg.matched_codes_present, ["no_market_bias", "tape_alignment"]);
});

test("aggregateBlockedForGate: zero matching rows in the window is measurable-but-empty, not not_measurable", () => {
  const agg = aggregateBlockedForGate([line("some_other_code")], GATE_CODE_FAMILIES["G-13"].codes);
  assert.equal(agg.measurable, true);
  assert.equal(agg.n, 0);
  assert.match(agg.reason, /no rejection rows observed/);
});

test("aggregateBlockedForGate: ungradeable reasons merge and cap at 5, most-frequent first", () => {
  const lines = [
    line("vix_extreme", {
      n: 5,
      would_have_won: 2,
      ungradeable_reasons: [
        { reason: "no bar data", n: 3 },
        { reason: "no direction", n: 1 },
      ],
    }),
    line("vix_elevated", {
      n: 5,
      would_have_won: 3,
      ungradeable_reasons: [{ reason: "no bar data", n: 4 }],
    }),
  ];
  const agg = aggregateBlockedForGate(lines, GATE_CODE_FAMILIES["G-4"].codes);
  assert.equal(agg.ungradeable_reasons[0].reason, "no bar data");
  assert.equal(agg.ungradeable_reasons[0].n, 7);
  assert.equal(agg.ungradeable_reasons[1].reason, "no direction");
});

test("evaluateGatePrimaryAblation: G-10 verdict is not_measurable even with a passed baseline present", () => {
  const row = evaluateGatePrimaryAblation({
    gateKey: "G-10",
    family: GATE_CODE_FAMILIES["G-10"],
    blockedValueLines: [line("tape_alignment", { n: 50, would_have_won: 20 })],
    passed: { graded: 500, win_rate_pct: 45, avg_pnl_pct: 3.2 },
  });
  assert.equal(row.verdict, "not_measurable");
  assert.equal(row.blocked.n, 0);
  assert.equal(row.blocked.assumed_ev_pct, null);
  assert.equal(row.delta_win_rate_pts_passed_minus_blocked, null);
});

test("evaluateGatePrimaryAblation: all_ungradeable is distinct from no_rejections_in_window", () => {
  // The gate DID fire (ungradeable=5) but nothing graded (n=0) — must not read as "never blocked".
  const fired = evaluateGatePrimaryAblation({
    gateKey: "G-1",
    family: GATE_CODE_FAMILIES["G-1"],
    blockedValueLines: [line("tape_alignment", { n: 0, would_have_won: 0, ungradeable: 5 })],
    passed: { graded: 100, win_rate_pct: 40, avg_pnl_pct: -1 },
  });
  assert.equal(fired.verdict, "all_ungradeable");
  assert.equal(fired.blocked.ungradeable, 5);

  // Truly nothing logged at all — the OTHER n=0 case.
  const silent = evaluateGatePrimaryAblation({
    gateKey: "G-4",
    family: GATE_CODE_FAMILIES["G-4"],
    blockedValueLines: [],
    passed: { graded: 100, win_rate_pct: 40, avg_pnl_pct: -1 },
  });
  assert.equal(silent.verdict, "no_rejections_in_window");
  assert.equal(silent.blocked.ungradeable, 0);
});

test("evaluateGatePrimaryAblation: low_n verdict below the meaningful-n floor, measurable above it", () => {
  const lines = [line("confluence_floor", { n: 6, would_have_won: 4 })];
  const low = evaluateGatePrimaryAblation({
    gateKey: "G-12",
    family: GATE_CODE_FAMILIES["G-12"],
    blockedValueLines: lines,
    passed: { graded: 100, win_rate_pct: 40, avg_pnl_pct: -2 },
    minMeaningfulN: 10,
  });
  assert.equal(low.verdict, "low_n");

  const measurable = evaluateGatePrimaryAblation({
    gateKey: "G-12",
    family: GATE_CODE_FAMILIES["G-12"],
    blockedValueLines: [line("confluence_floor", { n: 15, would_have_won: 10 })],
    passed: { graded: 100, win_rate_pct: 40, avg_pnl_pct: -2 },
    minMeaningfulN: 10,
  });
  assert.equal(measurable.verdict, "measurable");
});

test("evaluateGatePrimaryAblation: delta and assumed EV computed correctly on a real-shaped row", () => {
  const row = evaluateGatePrimaryAblation({
    gateKey: "G-4",
    family: GATE_CODE_FAMILIES["G-4"],
    blockedValueLines: [
      line("vix_extreme", { n: 10, would_have_won: 3, by_basis: { premium: 0, underlying: 10 } }),
      line("vix_elevated", { n: 10, would_have_won: 5, by_basis: { premium: 0, underlying: 10 } }),
    ],
    passed: { graded: 200, win_rate_pct: 48, avg_pnl_pct: 6.5 },
  });
  assert.equal(row.blocked.n, 20);
  assert.equal(row.blocked.wins, 8);
  assert.equal(row.blocked.win_rate_pct, 40); // 8/20
  assert.equal(row.blocked.assumed_ev_pct, assumedPlanPayoffEvPct(40));
  assert.equal(row.delta_win_rate_pts_passed_minus_blocked, 8); // 48 - 40
  assert.equal(row.verdict, "measurable");
});

test("platformWideSkipGradingHealth: flags systemic_zero_graded only when EVERY code is graded=0 with real ungradeable volume", () => {
  const allZero = [
    line("score_floor", { n: 0, ungradeable: 320 }),
    line("late_afternoon", { n: 0, ungradeable: 337 }),
    line("tape_alignment", { n: 0, ungradeable: 5 }),
  ];
  const health = platformWideSkipGradingHealth(allZero);
  assert.equal(health.systemic_zero_graded, true);
  assert.equal(health.total_graded, 0);
  assert.equal(health.total_ungradeable, 662);
  assert.equal(health.total_gate_codes_observed, 3);
});

test("platformWideSkipGradingHealth: NOT systemic when at least one code has real graded rows", () => {
  const mixed = [
    line("score_floor", { n: 0, ungradeable: 320 }),
    line("tape_alignment", { n: 12, would_have_won: 5, ungradeable: 2 }),
  ];
  const health = platformWideSkipGradingHealth(mixed);
  assert.equal(health.systemic_zero_graded, false);
  assert.equal(health.total_graded, 12);
});

test("platformWideSkipGradingHealth: no gate codes observed at all is not falsely flagged systemic", () => {
  const health = platformWideSkipGradingHealth([]);
  assert.equal(health.systemic_zero_graded, false);
  assert.equal(health.total_gate_codes_observed, 0);
});

test("evaluateAllGatesPrimaryAblation: emits exactly the five named gates, in a stable order", () => {
  const rows = evaluateAllGatesPrimaryAblation({ blockedValueLines: [], passed: null });
  assert.deepEqual(
    rows.map((r) => r.gate),
    ["G-1", "G-4", "G-10", "G-12", "G-13"]
  );
  // Every gate reports SOME verdict even with zero input — never a throw on empty data.
  for (const r of rows) assert.ok(typeof r.verdict === "string");
});
