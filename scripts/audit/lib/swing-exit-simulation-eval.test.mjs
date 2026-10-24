import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTicks,
  findFirstGateTick,
  simulateRowAcrossRules,
  aggregateRule,
  aggregateRuleByCategory,
  baselineStats,
  EXIT_RULES,
} from "./swing-exit-simulation-eval.mjs";

function snap(mark, { at, gating = false, rung = null, action = null, thesisState = "INTACT" } = {}) {
  return {
    option_mark: mark,
    dte_remaining: 5,
    thesis_state: thesisState,
    created_at: at ?? "2026-08-01T14:30:00.000Z",
    event_json: { gating, rung, action },
  };
}

test("normalizeTicks: drops ticks with no usable option_mark, never coerces to 0", () => {
  const row = { snapshots: [snap(10), { option_mark: null, created_at: "x", event_json: {} }, snap(0), snap(12)] };
  const ticks = normalizeTicks(row);
  assert.equal(ticks.length, 2);
  assert.deepEqual(ticks.map((t) => t.mark), [10, 12]);
});

test("findFirstGateTick: finds the first real gate, null when none fired", () => {
  const a = normalizeTicks({ snapshots: [snap(10), snap(11, { gating: true, rung: "structural_stop" }), snap(9)] });
  assert.equal(findFirstGateTick(a), 1);
  const b = normalizeTicks({ snapshots: [snap(10), snap(11), snap(9)] });
  assert.equal(findFirstGateTick(b), null);
});

test("simulateRowAcrossRules: fewer than 2 usable ticks -> hasChronology false, every rule null, current still from ground truth", () => {
  const row = { positionId: 1, ticker: "X", entryPremium: 10, peakPremium: 12, exitPnlPct: 20, closedReason: "target", snapshots: [snap(10)] };
  const r = simulateRowAcrossRules(row);
  assert.equal(r.hasChronology, false);
  assert.equal(r.current.realizedPnlPct, 20);
  for (const rule of EXIT_RULES) assert.equal(r.results[rule.id], null);
});

test("current_replica: reconstructs the shipped 50%@+100%/trail-50%-of-peak/-60% hard stop from a real path", () => {
  // Rises to +150% (peak 25), retraces to 60% of that peak (15) which is below the 50%-of-peak trail
  // level (25*0.5=12.5 is NOT breached at 15 -- so trail should NOT fire yet), then falls to 12 (below
  // 12.5) which SHOULD fire the trail.
  const entry = 10;
  const ticks = [
    snap(10), snap(15), snap(20), snap(25), // peak reached
    snap(18), snap(15), snap(12), // 12 <= 25*0.5=12.5 -> trail fires here
    snap(8),
  ];
  const row = { positionId: 2, ticker: "WIN", entryPremium: entry, peakPremium: 25, exitPnlPct: 999, closedReason: "target", snapshots: ticks };
  const r = simulateRowAcrossRules(row);
  assert.equal(r.hasChronology, true);
  const cur = r.results.current_replica;
  assert.ok(cur, "current_replica should simulate");
  assert.equal(cur.exitCause, "trail_stop");
  // Blended: 50% at the +100% trigger (mark=20, since that's the first mark >= 20 = entry*2), 50% at 12 (trail).
  // value = 0.5*20 + 0.5*12 = 16 -> pnl = (16/10 - 1)*100 = 60%
  assert.equal(cur.realizedPnlPct, 60);
});

test("current_replica: hard stop fires before any trim on a straight-down path", () => {
  const entry = 10;
  const ticks = [snap(10), snap(9), snap(7), snap(3.9)]; // 3.9 <= 10*0.4=4 -> hard stop
  const row = { positionId: 3, ticker: "LOSER", entryPremium: entry, peakPremium: 10, exitPnlPct: -61, closedReason: "stopped", snapshots: ticks };
  const r = simulateRowAcrossRules(row);
  const cur = r.results.current_replica;
  assert.equal(cur.exitCause, "hard_stop");
  assert.equal(cur.realizedPnlPct, -61);
});

test("thesis_invalidation_only and every other rule respect the SAME real gate floor, never later", () => {
  const entry = 10;
  const ticks = [
    snap(10), snap(30), // way past +100% and +50% triggers, would normally trim
    snap(31, { gating: true, rung: "structural_stop", action: "EXIT" }), // real gate fires HERE
    snap(50), // never seen by any rule -- if a rule used this, that would be look-ahead
  ];
  const row = { positionId: 4, ticker: "GATED", entryPremium: entry, peakPremium: 50, exitPnlPct: 210, closedReason: "stopped", snapshots: ticks };
  const r = simulateRowAcrossRules(row);
  for (const ruleId of ["no_early_trim", "current_replica", "trim_30_50_runner", "trim_50_runner_no_trail", "trailing_stop_after_mfe", "breakeven_stop", "thesis_invalidation_only"]) {
    const out = r.results[ruleId];
    assert.ok(out, `${ruleId} should simulate`);
    assert.equal(out.exitCause, "gate", `${ruleId} should exit on the gate`);
  }
  // thesis_invalidation_only has NO profit-taking, so it realizes 100% at the gate mark (31): +210%.
  assert.equal(r.results.thesis_invalidation_only.realizedPnlPct, 210);
});

test("trailing_stop_after_mfe: never arms below the gain threshold, rides to series end", () => {
  const entry = 10;
  const ticks = [snap(10), snap(10.5), snap(11), snap(10.8)]; // gain never reaches +50%
  const row = { positionId: 5, ticker: "FLAT", entryPremium: entry, peakPremium: 11, exitPnlPct: 8, closedReason: "flat", snapshots: ticks };
  const r = simulateRowAcrossRules(row);
  const out = r.results.trailing_stop_after_mfe;
  assert.equal(out.exitCause, "series_end");
  assert.equal(out.realizedPnlPct, 8); // (10.8/10-1)*100
});

test("breakeven_stop: arms at +25%, exits at breakeven (0%) on retrace to entry, not before", () => {
  const entry = 10;
  const ticks = [snap(10), snap(12.6), snap(11), snap(10)]; // arms at 12.6 (+26%), exits when mark==entry
  const row = { positionId: 6, ticker: "BE", entryPremium: entry, peakPremium: 12.6, exitPnlPct: -5, closedReason: "stopped", snapshots: ticks };
  const r = simulateRowAcrossRules(row);
  const out = r.results.breakeven_stop;
  assert.equal(out.exitCause, "breakeven_stop");
  assert.equal(out.realizedPnlPct, 0);
});

test("time_based_5: exits at the 5th tick's mark when no gate fires first", () => {
  const entry = 10;
  const ticks = [snap(10), snap(11), snap(12), snap(13), snap(14), snap(15), snap(16)];
  const row = { positionId: 7, ticker: "TIME", entryPremium: entry, peakPremium: 16, exitPnlPct: 60, closedReason: "target", snapshots: ticks };
  const r = simulateRowAcrossRules(row);
  const out = r.results.time_based_5;
  assert.equal(out.exitCause, "time_stop");
  assert.equal(out.realizedPnlPct, 50); // mark at index 5 (5 ticks after entry) = 15 -> (15/10-1)*100
});

test("mfeCapturedPct: null when there was no real favorable excursion to capture", () => {
  const entry = 10;
  const ticks = [snap(10), snap(9), snap(8)];
  const row = { positionId: 8, ticker: "DEADCAT", entryPremium: entry, peakPremium: 10, exitPnlPct: -20, closedReason: "stopped", snapshots: ticks };
  const r = simulateRowAcrossRules(row);
  assert.equal(r.current.mfeCapturedPct, null);
});

test("aggregateRule: win rate, expectancy, paired delta CI, winner-flip and premature-kill counts", () => {
  const rows = [
    { ticker: "A", positionId: 1, current: { realizedPnlPct: 100 }, results: { X: { realizedPnlPct: 40 } } }, // large winner, premature-killed (40 < 50% of 100)
    { ticker: "B", positionId: 2, current: { realizedPnlPct: 60 }, results: { X: { realizedPnlPct: -10 } } }, // winner turned loser AND also a large winner premature-killed (60 >= 50 threshold, -10 < 30)
    { ticker: "C", positionId: 3, current: { realizedPnlPct: -30 }, results: { X: { realizedPnlPct: -20 } } },
    { ticker: "D", positionId: 4, current: { realizedPnlPct: 20 }, results: { X: { realizedPnlPct: 25 } } },
  ];
  const agg = aggregateRule(rows, "X");
  assert.equal(agg.n, 4);
  assert.equal(agg.turnedWinnerIntoLoser, 1); // only B
  assert.equal(agg.turnedWinnerIntoLoserRate, 33.33); // 1 of 3 actual winners (A,B,D)
  assert.equal(agg.largeWinnerN, 2); // A (100) and B (60), both >= the 50 threshold
  assert.equal(agg.prematurelyKilledLargeWinners, 2); // A: 40 < 100*0.5; B: -10 < 60*0.5
  assert.ok(agg.expectancy != null);
});

test("aggregateRule: rows missing either side are excluded, never coerced to zero", () => {
  const rows = [
    { ticker: "A", current: { realizedPnlPct: 10 }, results: { X: { realizedPnlPct: 20 } } },
    { ticker: "B", current: { realizedPnlPct: null }, results: { X: { realizedPnlPct: 20 } } },
    { ticker: "C", current: { realizedPnlPct: 10 }, results: { X: null } },
  ];
  const agg = aggregateRule(rows, "X");
  assert.equal(agg.n, 1);
});

test("aggregateRule: NO DATA when nothing pairs", () => {
  const agg = aggregateRule([], "X");
  assert.equal(agg.verdict, "NO DATA");
  assert.equal(agg.n, 0);
});

test("baselineStats: unconditional win-rate/expectancy for the ground-truth 'current' arm, no candidate needed", () => {
  const rows = [
    { current: { realizedPnlPct: 100 } },
    { current: { realizedPnlPct: -40 } },
    { current: { realizedPnlPct: -20 } },
    { current: { realizedPnlPct: null } }, // excluded, never coerced to 0
  ];
  const b = baselineStats(rows);
  assert.equal(b.n, 3);
  assert.equal(b.winRate, 33.33);
  assert.equal(b.avgWinner, 100);
  assert.equal(b.avgLoser, -30);
});

test("baselineStats: NO DATA when nothing usable", () => {
  assert.equal(baselineStats([{ current: { realizedPnlPct: null } }]).verdict, "NO DATA");
});

test("aggregateRuleByCategory: groups by an arbitrary category function, sorted by n descending", () => {
  const rows = [
    { direction: "LONG", current: { realizedPnlPct: 10 }, results: { X: { realizedPnlPct: 20 } } },
    { direction: "LONG", current: { realizedPnlPct: -10 }, results: { X: { realizedPnlPct: -5 } } },
    { direction: "SHORT", current: { realizedPnlPct: 30 }, results: { X: { realizedPnlPct: 25 } } },
  ];
  const groups = aggregateRuleByCategory(rows, "X", (r) => r.direction);
  assert.equal(groups[0].label, "LONG");
  assert.equal(groups[0].n, 2);
  assert.equal(groups[1].label, "SHORT");
  assert.equal(groups[1].n, 1);
});
