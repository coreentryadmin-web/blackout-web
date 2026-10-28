import test from "node:test";
import assert from "node:assert/strict";
import { nearestStrike, pairedCompare, winRate } from "./flow-atm-selector-eval.mjs";

test("nearestStrike: picks the closest real strike to spot", () => {
  assert.equal(nearestStrike([100, 105, 110], 104), 105);
  assert.equal(nearestStrike([100, 105, 110], 100.2), 100);
});

test("nearestStrike: empty list returns null, never a fabricated strike", () => {
  assert.equal(nearestStrike([], 100), null);
  assert.equal(nearestStrike(undefined, 100), null);
});

test("nearestStrike: exact match returns that strike", () => {
  assert.equal(nearestStrike([95, 100, 105], 100), 100);
});

test("pairedCompare: empty input -> NO DATA, never a fabricated verdict", () => {
  const r = pairedCompare([]);
  assert.equal(r.n, 0);
  assert.equal(r.verdict, "NO DATA");
  assert.equal(r.ci, null);
});

test("pairedCompare: single pair -> INSUFFICIENT N (variance undefined at n=1)", () => {
  const r = pairedCompare([{ actual: 10, atm: 20, delta: 10 }]);
  assert.equal(r.n, 1);
  assert.equal(r.verdict, "INSUFFICIENT N");
});

test("pairedCompare: a real, consistent positive delta with tight variance -> ATM SEPARATED", () => {
  const pairs = Array.from({ length: 30 }, (_, i) => ({ actual: 0, atm: 10 + (i % 2 === 0 ? 0.1 : -0.1), delta: 10 + (i % 2 === 0 ? 0.1 : -0.1) }));
  const r = pairedCompare(pairs);
  assert.equal(r.verdict, "ATM SEPARATED (better)");
  assert.ok(r.ci.lo > 0, `expected CI lower bound above zero, got ${r.ci.lo}`);
});

test("pairedCompare: a real, consistent negative delta -> ACTUAL (top_strike) SEPARATED", () => {
  const pairs = Array.from({ length: 30 }, (_, i) => ({ actual: 10, atm: 0, delta: -10 + (i % 2 === 0 ? 0.1 : -0.1) }));
  const r = pairedCompare(pairs);
  assert.equal(r.verdict, "ACTUAL (top_strike) SEPARATED (better)");
  assert.ok(r.ci.hi < 0, `expected CI upper bound below zero, got ${r.ci.hi}`);
});

test("pairedCompare: noisy deltas straddling zero -> INCONCLUSIVE, not forced to a side", () => {
  const pairs = [
    { actual: 0, atm: 50, delta: 50 },
    { actual: 50, atm: 0, delta: -50 },
    { actual: 10, atm: 15, delta: 5 },
    { actual: 15, atm: 10, delta: -5 },
  ];
  const r = pairedCompare(pairs);
  assert.equal(r.verdict, "INCONCLUSIVE");
});

test("pairedCompare: meanActual/meanAtm/meanDelta are computed correctly", () => {
  const pairs = [
    { actual: 10, atm: 20, delta: 10 },
    { actual: -10, atm: -5, delta: 5 },
  ];
  const r = pairedCompare(pairs);
  assert.equal(r.meanActual, 0);
  assert.equal(r.meanAtm, 7.5);
  assert.equal(r.meanDelta, 7.5);
});

test("winRate: empty population returns null, never a fabricated rate", () => {
  assert.equal(winRate([], "actual"), null);
});

test("winRate: counts only strictly positive pnl as a win", () => {
  const pairs = [{ actual: 10, atm: -5 }, { actual: -10, atm: 20 }, { actual: 0, atm: 0 }];
  assert.equal(winRate(pairs, "actual"), Math.round((1 / 3) * 1000) / 10);
  assert.equal(winRate(pairs, "atm"), Math.round((1 / 3) * 1000) / 10);
});
