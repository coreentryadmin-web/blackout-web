import { test } from "node:test";
import assert from "node:assert/strict";
import { assessExecution, executionAdjustedReturnPct } from "./slippage.ts";

test("expected read from the quote alone: mid, spread, expected fill given aggressiveness", () => {
  const a = assessExecution({ quote: { bid: 4.0, ask: 4.4 }, side: "BUY", aggressiveness: 0.5 });
  assert.equal(a.mid, 4.2);
  assert.equal(a.spread, 0.4);
  assert.ok(Math.abs(a.spreadPct! - 0.0952) < 0.001); // 0.4/4.2
  assert.equal(a.expectedFill, 4.3); // mid 4.2 + 0.5×half-spread(0.2) = 4.3
  assert.equal(a.expectedSlippageCost, 0.1);
  assert.equal(a.fill, null); // no fill supplied → realized read absent
  assert.equal(a.quality, null);
});

test("BUY paying above mid is an adverse cost; a fill at/under expected grades GOOD", () => {
  const a = assessExecution({ quote: { bid: 4.0, ask: 4.4 }, side: "BUY", fill: 4.25, aggressiveness: 0.5 });
  assert.equal(a.realizedSlippageCost, 0.05); // paid 4.25 vs mid 4.2 → +0.05 adverse
  assert.equal(a.slippageVsExpected, 0.05 - 0.1); // realized 0.05 < expected 0.10 → better
  assert.equal(a.quality, "GOOD");
});

test("BUY paying near the ask grades POOR (worse than the marketable-limit assumption)", () => {
  const a = assessExecution({ quote: { bid: 4.0, ask: 4.4 }, side: "BUY", fill: 4.4, aggressiveness: 0.5 });
  assert.equal(a.realizedSlippageCost, 0.2); // paid the ask → +0.20
  assert.ok(a.slippageVsExpected! > 0);
  assert.equal(a.quality, "POOR");
});

test("SELL is symmetric: receiving BELOW mid is the adverse cost", () => {
  const a = assessExecution({ quote: { bid: 4.0, ask: 4.4 }, side: "SELL", fill: 4.05, aggressiveness: 0.5 });
  // sold at 4.05 vs mid 4.2 → received 0.15 less → +0.15 adverse
  assert.equal(a.realizedSlippageCost, 0.15);
  assert.equal(a.expectedFill, 4.1); // mid − 0.5×0.2
});

test("round-trip cost is the FULL spread as % of mid — the fixed drag every scalp pays", () => {
  const a = assessExecution({ quote: { bid: 1.0, ask: 1.3 }, side: "BUY" });
  // spread 0.3 on mid 1.15 → 26% round-trip drag — a wide-spread 0DTE contract eats the edge
  assert.ok(Math.abs(a.roundTripCostPct! - 0.2609) < 0.001);
});

test("degrades safely: crossed/absent quote → null mid, no fabricated numbers", () => {
  assert.equal(assessExecution({ quote: { bid: 4.4, ask: 4.0 }, side: "BUY" }).mid, null); // crossed
  assert.equal(assessExecution({ quote: { bid: null, ask: null }, side: "BUY" }).mid, null);
  const a = assessExecution({ quote: { bid: null, ask: null }, side: "BUY", fill: 4.2 });
  assert.equal(a.realizedSlippageCost, null); // no mid → can't price slippage
});

test("execution-adjusted return subtracts the round-trip spread drag from the idealized P&L", () => {
  // +100% ideal on a $4.20 entry with a $0.40 spread → drag = 0.40/4.20 = 9.52% → ~90.48% realized.
  const adj = executionAdjustedReturnPct(100, 4.2, 0.4);
  assert.ok(Math.abs(adj! - 90.476) < 0.01);
});

test("execution-adjusted return: no priceable drag → unchanged; no ideal → null", () => {
  assert.equal(executionAdjustedReturnPct(100, null, 0.4), 100);
  assert.equal(executionAdjustedReturnPct(100, 4.2, null), 100);
  assert.equal(executionAdjustedReturnPct(null, 4.2, 0.4), null);
});
