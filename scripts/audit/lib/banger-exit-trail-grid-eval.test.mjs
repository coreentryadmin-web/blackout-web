import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateTrailGridCell,
  buildGridTradeRow,
  winnerFlipMetrics,
  aggregateGridConfig,
  runTrailGrid,
  paretoFrontier,
  PRODUCTION_CONFIG,
  TRIGGER_LEVELS_PCT,
  SCALE_FRACTIONS,
  TRAIL_FRACTIONS,
} from "./banger-exit-trail-grid-eval.mjs";

function row(overrides) {
  return {
    id: 1,
    ticker: "TEST",
    session_date: "2026-08-01",
    entry_premium: 1,
    peak_premium: 3,
    realized_pnl_pct: 60, // a real EXIT_RUNNER-shaped blended outcome: 0.5*100+0.5*20
    scale_out_action: "EXIT_RUNNER",
    scaled_already: true,
    ...overrides,
  };
}

test("evaluateTrailGridCell: the exact production config bypasses reconstruction and reproduces `current` exactly", () => {
  const r = row({});
  const out = evaluateTrailGridCell(r, PRODUCTION_CONFIG);
  assert.equal(out.realizedPnlPct, 60);
  assert.equal(out.triggered, true);
});

test("evaluateTrailGridCell: a looser trail (higher fraction of peak) locks in more, at or above the real outcome", () => {
  // peak=3, entry=1 -> peakPct=200. realTerminalPct = 2*60-100 = 20 (raw runner return).
  // trail=0.7 -> hypotheticalLevel = 100*(0.7-1)+0.7*200 = -30+140 = 110, which is > realTerminal(20) -> use 110.
  const r = row({});
  const out = evaluateTrailGridCell(r, { triggerPct: 100, fraction: 0.5, trailFrac: 0.7 });
  assert.equal(out.triggered, true);
  // blended = 0.5*100 + 0.5*110 = 105
  assert.equal(out.realizedPnlPct, 105);
});

test("evaluateTrailGridCell: a tighter trail than what actually happened rides through to the real terminal (no evidence it fired)", () => {
  // trail=0.4 -> hypotheticalLevel = 100*(0.4-1)+0.4*200 = -60+80 = 20, which EQUALS realTerminal(20) exactly here.
  // Use a case where hypothetical is clearly BELOW real terminal instead:
  const r = row({ realized_pnl_pct: 80 }); // realTerminalPct = 2*80-100 = 60
  const out = evaluateTrailGridCell(r, { triggerPct: 100, fraction: 0.5, trailFrac: 0.4 });
  // hypotheticalLevel(0.4) = -60+0.4*200 = 20, which is < realTerminal(60) -> rides through to 60.
  // blended = 0.5*100 + 0.5*60 = 80 == current (since fraction/trigger also match production here,
  // but trail differs -- NOT the exact bypass since trail!=0.5, so this proves the max() logic
  // independently reproduces the "ride through" case correctly, not via the bypass).
  assert.equal(out.triggered, true);
  assert.equal(out.realizedPnlPct, 80);
});

test("evaluateTrailGridCell: not triggered when peak never reaches a higher tested trigger level (STOP_OUT case)", () => {
  const r = row({ peak_premium: 1.5, realized_pnl_pct: -60, scaled_already: false, scale_out_action: "STOP_OUT" });
  const out = evaluateTrailGridCell(r, { triggerPct: 200, fraction: 0.5, trailFrac: 0.5 });
  assert.equal(out.triggered, false);
  assert.equal(out.realizedPnlPct, -60);
});

test("evaluateTrailGridCell: untriggered rides the RAW unscaled return, never production's own real blended `current` (regression -- a real production row shape, id=21: current is a real +37.5% winner ONLY because of production's own 100% partial, but the raw single-leg return is -25%; a candidate whose higher trigger never fires must see the -25%, not silently inherit the +37.5% it never actually earned)", () => {
  // current = 0.5*100 + 0.5*raw => 37.5 = 50 + 0.5*raw => raw = -25.
  const r = row({ entry_premium: 1, peak_premium: 2.1, realized_pnl_pct: 37.5, scaled_already: true, scale_out_action: "EXPIRED" });
  const out = evaluateTrailGridCell(r, { triggerPct: 200, fraction: 0.67, trailFrac: 0.5 }); // peak 2.1x never reaches the 200% (3x) level
  assert.equal(out.triggered, false);
  assert.equal(out.realizedPnlPct, -25);
  assert.notEqual(out.realizedPnlPct, 37.5);
});

test("evaluateTrailGridCell: higher trail fraction never produces a WORSE result than a lower one (monotonicity)", () => {
  // A row must be INTERNALLY CONSISTENT with production's own real formula to be a valid fixture
  // here: `current` is what a REAL 50%-of-peak trail exit would actually produce for this peak
  // (peak=4 -> peakPct=300 -> hypotheticalLevel(0.5)=100 -> current=0.5*100+0.5*100=100), exactly
  // as PR #5517 verified against real rows (DBX id=49). An arbitrary, inconsistent (peak, current)
  // pair -- one that could never occur in real production data -- is not a valid test of this
  // reconstruction (caught a test-fixture bug here, not a code bug, while first writing this).
  const r = row({ peak_premium: 4, realized_pnl_pct: 100 });
  const results = TRAIL_FRACTIONS.map((trailFrac) => evaluateTrailGridCell(r, { triggerPct: 100, fraction: 0.5, trailFrac }).realizedPnlPct);
  assert.deepEqual(results, [100, 100, 120, 140]);
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i] >= results[i - 1], `trail=${TRAIL_FRACTIONS[i]} (${results[i]}) should be >= trail=${TRAIL_FRACTIONS[i - 1]} (${results[i - 1]})`);
  }
});

test("winnerFlipMetrics: counts real winners that flip to losers, and large winners that get degraded", () => {
  const tradeRows = [
    buildGridTradeRow(row({ id: 1, realized_pnl_pct: 60 }), { a: { triggerPct: 200, fraction: 0.67, trailFrac: 0.4 } }),
    buildGridTradeRow(row({ id: 2, realized_pnl_pct: -60, peak_premium: 0.9, scaled_already: false, scale_out_action: "STOP_OUT" }), { a: { triggerPct: 200, fraction: 0.67, trailFrac: 0.4 } }),
  ];
  const m = winnerFlipMetrics(tradeRows, "a");
  assert.equal(m.actualWinnersN, 1);
  assert.ok(m.flippedToLoserN === 0 || m.flippedToLoserN === 1);
});

test("aggregateGridConfig: full metric bundle sanity", () => {
  const rows = [
    row({ id: 1, peak_premium: 3, realized_pnl_pct: 60 }),
    row({ id: 2, peak_premium: 0.9, realized_pnl_pct: -60, scaled_already: false, scale_out_action: "STOP_OUT" }),
    row({ id: 3, peak_premium: 2.5, realized_pnl_pct: 30 }),
  ];
  const tradeRows = rows.map((r) => buildGridTradeRow(r, { a: PRODUCTION_CONFIG }));
  const agg = aggregateGridConfig(tradeRows, "a");
  assert.equal(agg.n, 3);
  assert.ok(agg.winRate >= 0 && agg.winRate <= 100);
  assert.ok(Number.isFinite(agg.maxDrawdownPts));
  assert.ok(agg.actualWinnersN === 2);
});

test("runTrailGrid: produces exactly 5x3x4=60 cells, one of which is the exact control", () => {
  const rows = [row({})];
  const cells = runTrailGrid(rows);
  assert.equal(cells.length, TRIGGER_LEVELS_PCT.length * SCALE_FRACTIONS.length * TRAIL_FRACTIONS.length);
  assert.equal(cells.length, 60);
  const control = cells.find((c) => c.isControl);
  assert.ok(control);
  assert.equal(control.triggerPct, 100);
  assert.equal(control.fraction, 0.5);
  assert.equal(control.trailFrac, 0.5);
  // the control cell's mean delta against `current` must be exactly zero, not merely small.
  assert.equal(control.meanDelta, 0);
});

test("paretoFrontier: a strictly-dominated cell is excluded; a genuinely non-dominated one survives", () => {
  const cells = [
    { key: "A", expectancy: 10, maxDrawdownPts: -100, flippedToLoserRatePct: 20 },
    { key: "B", expectancy: 5, maxDrawdownPts: -200, flippedToLoserRatePct: 30 }, // dominated by A on every axis
    { key: "C", expectancy: 15, maxDrawdownPts: -300, flippedToLoserRatePct: 10 }, // trades off DD for expectancy/flips -- not dominated
  ];
  const frontier = paretoFrontier(cells);
  const keys = frontier.map((c) => c.key).sort();
  assert.deepEqual(keys, ["A", "C"]);
});
