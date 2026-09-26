import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateGridCellForRow,
  evaluateSummaryTierGridCell,
  aggregateGridCell,
  runGrid,
  splitByDateHalves,
  TRIGGER_LEVELS_PCT,
  SCALE_OUT_FRACTIONS,
} from "./swing-exit-optimization-eval.mjs";

function snap(mark, { gating = false } = {}) {
  return { option_mark: mark, event_json: { gating } };
}
function row(entryPremium, peakPremium, snapshots) {
  return { entryPremium, peakPremium, snapshots };
}

test("evaluateGridCellForRow: trigger never reached -> rides 100% to series end, triggered=false", () => {
  const r = row(10, 11, [snap(10), snap(10.5), snap(11), snap(10.8)]);
  const out = evaluateGridCellForRow(r, { triggerPct: 100, fraction: 0.5, runnerStyle: "thesis_risk" });
  assert.equal(out.triggered, false);
  assert.equal(out.exitCause, "series_end");
  assert.equal(out.realizedPnlPct, 8); // (10.8/10-1)*100
});

test("evaluateGridCellForRow: gate fires before trigger -> 100% out at gate, no trim ever happens", () => {
  const r = row(10, 30, [snap(10), snap(15), snap(9, { gating: true }), snap(30)]);
  const out = evaluateGridCellForRow(r, { triggerPct: 100, fraction: 0.5, runnerStyle: "thesis_risk" });
  assert.equal(out.triggered, false);
  assert.equal(out.exitCause, "gate");
  assert.equal(out.realizedPnlPct, -10); // (9/10-1)*100
});

test("evaluateGridCellForRow: thesis_risk runner rides to series end after trim, no extra exit logic", () => {
  const r = row(10, 25, [snap(10), snap(20), snap(25), snap(15), snap(5)]);
  const out = evaluateGridCellForRow(r, { triggerPct: 100, fraction: 0.5, runnerStyle: "thesis_risk" });
  assert.equal(out.triggered, true);
  assert.equal(out.exitCause, "series_end");
  // trim at first mark >= 20 (index1, mark=20), runner rides to last mark=5.
  // value = 0.5*20 + 0.5*5 = 12.5 -> pnl = (12.5/10-1)*100 = 25
  assert.equal(out.realizedPnlPct, 25);
});

test("evaluateGridCellForRow: trailing_stop exits on a real retrace from the runner's own peak-since-trim", () => {
  const r = row(10, 30, [snap(10), snap(20), snap(30), snap(16), snap(14)]); // 14 <= 30*0.5=15 -> fires at mark=14
  const out = evaluateGridCellForRow(r, { triggerPct: 100, fraction: 0.5, runnerStyle: "trailing_stop", trailBackPct: 50 });
  assert.equal(out.exitCause, "trail_stop");
  // trim at mark=20 (first >=20), runner peak reaches 30, exits once mark <= 30*0.5=15 (mark=14)
  // value = 0.5*20 + 0.5*14 = 17 -> pnl = 70
  assert.equal(out.realizedPnlPct, 70);
});

test("evaluateGridCellForRow: breakeven_stop exits when the runner falls back to original entry", () => {
  const r = row(10, 25, [snap(10), snap(20), snap(25), snap(15), snap(10)]);
  const out = evaluateGridCellForRow(r, { triggerPct: 100, fraction: 0.5, runnerStyle: "breakeven_stop" });
  assert.equal(out.exitCause, "breakeven_stop");
  // trim at mark=20, runner exits at mark=10 (== entry)
  // value = 0.5*20 + 0.5*10 = 15 -> pnl = 50
  assert.equal(out.realizedPnlPct, 50);
});

test("evaluateGridCellForRow: time_exit fires exactly N ticks after the trim, not N ticks from series start", () => {
  const r = row(10, 20, [snap(10), snap(15), snap(20), snap(19), snap(18), snap(17), snap(16)]);
  // trim fires at index2 (mark=20). time_exit holdTicksAfterTrim=2 -> exits at index4 (mark=18).
  const out = evaluateGridCellForRow(r, { triggerPct: 100, fraction: 0.5, runnerStyle: "time_exit", holdTicksAfterTrim: 2 });
  assert.equal(out.exitCause, "time_exit");
  // value = 0.5*20 + 0.5*18 = 19 -> pnl = 90
  assert.equal(out.realizedPnlPct, 90);
});

test("evaluateGridCellForRow: a gate during the runner phase overrides any runner style", () => {
  const r = row(10, 25, [snap(10), snap(20), snap(25), snap(22, { gating: true }), snap(5)]);
  const out = evaluateGridCellForRow(r, { triggerPct: 100, fraction: 0.5, runnerStyle: "time_exit", holdTicksAfterTrim: 50 });
  assert.equal(out.exitCause, "gate");
  // value = 0.5*20 + 0.5*22 = 21 -> pnl = 110
  assert.equal(out.realizedPnlPct, 110);
});

test("evaluateGridCellForRow: null when no chronology (fewer than 2 usable ticks)", () => {
  const r = row(10, 12, [snap(10)]);
  const out = evaluateGridCellForRow(r, { triggerPct: 100, fraction: 0.5, runnerStyle: "thesis_risk" });
  assert.equal(out, null);
});

test("evaluateSummaryTierGridCell: triggered blend matches the trigger level + real final exit", () => {
  const r = { entry_premium: 10, peak_premium: 25, realized_pnl_pct: 40 };
  const out = evaluateSummaryTierGridCell(r, { triggerPct: 100, fraction: 0.5 });
  assert.equal(out.triggered, true);
  // 0.5*100 + 0.5*40 = 70
  assert.equal(out.realizedPnlPct, 70);
});

test("evaluateSummaryTierGridCell: not triggered when peak never reaches the level -> real exit unchanged", () => {
  const r = { entry_premium: 10, peak_premium: 15, realized_pnl_pct: -20 };
  const out = evaluateSummaryTierGridCell(r, { triggerPct: 100, fraction: 0.5 });
  assert.equal(out.triggered, false);
  assert.equal(out.realizedPnlPct, -20);
});

test("evaluateGridCellForRow/evaluateSummaryTierGridCell: mfeCapturedPct is null on a round-trip to loss, never an exploding negative ratio", () => {
  // A tiny +2% peak that round-trips to -80% would otherwise report "captured -4000%" -- noise,
  // not signal, per this repo's own mfeCaptureOutcome (mfe-capture.ts) discipline.
  const r = { entry_premium: 10, peak_premium: 10.2, realized_pnl_pct: -80 };
  const out = evaluateSummaryTierGridCell(r, { triggerPct: 500, fraction: 0.5 }); // never triggers at this level
  assert.equal(out.realizedPnlPct, -80);
  assert.equal(out.mfeCapturedPct, null);
});

test("aggregateGridCell: win rate, median, profit factor, expectancy, failure-mode rates", () => {
  const paired = [
    { current: 100, candidate: { realizedPnlPct: 40, mfeCapturedPct: 40, maxDrawdownAfterProfitPct: -10, triggered: true } },
    { current: 60, candidate: { realizedPnlPct: -10, mfeCapturedPct: null, maxDrawdownAfterProfitPct: -50, triggered: true } },
    { current: -30, candidate: { realizedPnlPct: -20, mfeCapturedPct: null, maxDrawdownAfterProfitPct: null, triggered: false } },
    { current: 20, candidate: { realizedPnlPct: 25, mfeCapturedPct: 80, maxDrawdownAfterProfitPct: -5, triggered: true } },
  ];
  const agg = aggregateGridCell(paired);
  assert.equal(agg.n, 4);
  assert.equal(agg.winRate, 50); // 2 of 4 (40, 25)
  assert.equal(agg.medianRealized, 7.5); // sorted [-20,-10,25,40] -> avg of the two middle values
});

test("aggregateGridCell: profit factor is sum(wins)/abs(sum(losses)) on a % basis", () => {
  const paired = [
    { current: 10, candidate: { realizedPnlPct: 60, triggered: true } },
    { current: 10, candidate: { realizedPnlPct: 40, triggered: true } },
    { current: 10, candidate: { realizedPnlPct: -20, triggered: true } },
    { current: 10, candidate: { realizedPnlPct: -30, triggered: true } },
  ];
  const agg = aggregateGridCell(paired);
  // sumPos=100, sumNegAbs=50 -> profitFactor=2
  assert.equal(agg.profitFactor, 2);
});

test("aggregateGridCell: turnedWinnerIntoLoser and prematurelyKilledLargeWinners rates", () => {
  const paired = [
    { current: 100, candidate: { realizedPnlPct: 40, triggered: true } }, // large winner, premature-killed
    { current: 60, candidate: { realizedPnlPct: -10, triggered: true } }, // winner turned loser, also large-winner premature-killed
    { current: -30, candidate: { realizedPnlPct: -20, triggered: false } },
    { current: 20, candidate: { realizedPnlPct: 25, triggered: true } },
  ];
  const agg = aggregateGridCell(paired);
  assert.equal(agg.turnedWinnerIntoLoser, 1);
  assert.equal(agg.turnedWinnerIntoLoserRate, 33.33); // 1 of 3 actual winners (100,60,20)
  assert.equal(agg.largeWinnerN, 2); // 100 and 60
  assert.equal(agg.prematurelyKilledLargeWinners, 2);
});

test("aggregateGridCell: reachRatePct reflects how often the config's trigger actually fired", () => {
  const paired = [
    { current: 10, candidate: { realizedPnlPct: 5, triggered: true } },
    { current: 10, candidate: { realizedPnlPct: 5, triggered: false } },
    { current: 10, candidate: { realizedPnlPct: 5, triggered: false } },
    { current: 10, candidate: { realizedPnlPct: 5, triggered: true } },
  ];
  const agg = aggregateGridCell(paired);
  assert.equal(agg.triggeredCount, 2);
  assert.equal(agg.reachRatePct, 50);
});

test("aggregateGridCell: rows missing a side are excluded, never coerced", () => {
  const paired = [
    { current: 10, candidate: { realizedPnlPct: 20, triggered: true } },
    { current: null, candidate: { realizedPnlPct: 20, triggered: true } },
    { current: 10, candidate: null },
  ];
  const agg = aggregateGridCell(paired);
  assert.equal(agg.n, 1);
});

test("runGrid: produces exactly 6x4=24 cells with the right trigger/fraction pairs", () => {
  const rows = [{ entryPremium: 10, peakPremium: 30, exitPnlPct: 20, snapshots: [snap(10), snap(20), snap(30), snap(15)] }];
  const cells = runGrid(rows, {
    currentOf: (r) => r.exitPnlPct,
    evalOf: (r, cfg) => evaluateGridCellForRow(r, cfg),
  });
  assert.equal(cells.length, TRIGGER_LEVELS_PCT.length * SCALE_OUT_FRACTIONS.length);
  assert.equal(cells.length, 24);
  const first = cells[0];
  assert.equal(first.triggerPct, TRIGGER_LEVELS_PCT[0]);
  assert.equal(first.fraction, SCALE_OUT_FRACTIONS[0]);
});

test("splitByDateHalves: chronological split, ties go to the earlier half, invalid dates dropped", () => {
  const rows = [
    { id: 1, d: "2026-08-01" },
    { id: 2, d: "2026-08-05" },
    { id: 3, d: "2026-08-10" },
    { id: 4, d: "2026-08-15" },
    { id: 5, d: "not-a-date" },
  ];
  const { early, late, splitDate } = splitByDateHalves(rows, (r) => r.d);
  assert.equal(early.length + late.length, 4); // the invalid-date row is dropped
  assert.equal(early.length, 2);
  assert.equal(late.length, 2);
  assert.equal(early[0].id, 1);
  assert.equal(late[late.length - 1].id, 4);
  assert.equal(splitDate, "2026-08-05");
});
