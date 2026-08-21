import { strict as assert } from "node:assert";
import test from "node:test";
import { buildCondorRecord, isCondorRow } from "./condor-record";

test("isCondorRow keys strictly on the pinned play_type", () => {
  assert.equal(isCondorRow({ play_type: "CONDOR" }), true);
  assert.equal(isCondorRow({ play_type: "FLOW" }), false);
  assert.equal(isCondorRow({ play_type: "DIRECTIONAL" }), false);
  assert.equal(isCondorRow(null), false);
  assert.equal(isCondorRow({}), false);
});

test("an empty condor lane states there is NO live record and points to the backtest", () => {
  const r = buildCondorRecord([]);
  assert.equal(r.committed, 0);
  assert.equal(r.graded, 0);
  assert.equal(r.win_rate_pct, null, "no realized rate can be quoted with zero graded");
  assert.equal(r.breach_rate_pct, null);
  assert.equal(r.no_live_record, true);
  assert.match(r.note, /NO realized track record/);
  assert.match(r.note, /do not present the backtest as live performance/);
});

test("the REALIZED win rate and breach rate come from actual grades, not a backtest", () => {
  const r = buildCondorRecord([
    { plan_outcome: "condor_win", plan_pnl_pct: 12 },
    { plan_outcome: "condor_win", plan_pnl_pct: 10 },
    { plan_outcome: "condor_win", plan_pnl_pct: 14 },
    { plan_outcome: "condor_breach_loss", plan_pnl_pct: -60 },
    { plan_outcome: "ungradeable", plan_pnl_pct: null }, // not terminal — excluded from graded
  ]);
  assert.equal(r.committed, 5);
  assert.equal(r.graded, 4, "ungradeable is not a grade");
  assert.equal(r.wins, 3);
  assert.equal(r.breach_losses, 1);
  assert.equal(r.win_rate_pct, 75); // 3/4
  assert.equal(r.breach_rate_pct, 25); // 1/4 — the REAL breach rate, to compare vs backtested 18.7
  assert.equal(r.no_live_record, false);
  assert.match(r.note, /REALIZED record/);
});

test("committed-but-ungraded condors quote no rate rather than a fabricated one", () => {
  const r = buildCondorRecord([{ plan_outcome: "ungradeable", plan_pnl_pct: null }]);
  assert.equal(r.committed, 1);
  assert.equal(r.graded, 0);
  assert.equal(r.win_rate_pct, null);
  assert.equal(r.no_live_record, true);
  assert.match(r.note, /none have a terminal grade/);
});

test("avg P&L blends the kept credits and the defined losses over graded condors", () => {
  const r = buildCondorRecord([
    { plan_outcome: "condor_win", plan_pnl_pct: 20 },
    { plan_outcome: "condor_breach_loss", plan_pnl_pct: -60 },
  ]);
  assert.equal(r.avg_pnl_pct, -20); // (20 + -60)/2
});
