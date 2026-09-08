// Pure-core tests for the calibration statistics kernel (Hardening WS-09). No IO, no clock.
import { test } from "node:test";
import assert from "node:assert/strict";

import { wilsonInterval, proportionDiffCI } from "./calibration-stats";

const near = (actual: number, expected: number, tol = 5e-3): void => {
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} not within ${tol} of ${expected}`);
};

test("wilsonInterval: k=8,n=10 matches the ~[0.49,0.94] reference", () => {
  const ci = wilsonInterval(8, 10);
  near(ci.lo, 0.4901);
  near(ci.hi, 0.9433);
  near(ci.mid!, 0.7167);
});

test("wilsonInterval: extremes stay inside [0,1] and never collapse to zero width", () => {
  const perfect = wilsonInterval(10, 10); // p=1 — Wald would give [1,1]; Wilson must not
  assert.ok(perfect.lo < 1 && perfect.lo > 0, `lo=${perfect.lo}`);
  assert.equal(perfect.hi, 1);
  const zero = wilsonInterval(0, 10); // p=0 — Wald would give [0,0]
  assert.equal(zero.lo, 0);
  assert.ok(zero.hi > 0 && zero.hi < 1, `hi=${zero.hi}`);
});

test("wilsonInterval: n=0 → uninformative [0,1] with null center", () => {
  const ci = wilsonInterval(0, 0);
  assert.deepEqual(ci, { lo: 0, hi: 1, mid: null });
});

test("wilsonInterval: larger n tightens the interval around the same point estimate", () => {
  const small = wilsonInterval(8, 10);
  const large = wilsonInterval(80, 100);
  assert.ok(large.hi - large.lo < small.hi - small.lo, "n=100 interval should be tighter than n=10");
});

test("proportionDiffCI: significant decay is detected as hi<0; a flat split is not", () => {
  // Later much worse than earlier: earlier 18/20 = 90%, later 2/20 = 10% → diff −0.8, whole CI < 0.
  const decayed = proportionDiffCI(18, 20, 2, 20);
  near(decayed.diff, -0.8);
  assert.ok(decayed.hi < 0, `expected significant decay, hi=${decayed.hi}`);
  // No real change: 10/20 vs 10/20 → diff 0, CI straddles 0.
  const flat = proportionDiffCI(10, 20, 10, 20);
  assert.equal(flat.diff, 0);
  assert.ok(flat.hi >= 0 && flat.lo <= 0);
});

test("proportionDiffCI: empty partition → maximally uninformative, no divide-by-zero", () => {
  assert.deepEqual(proportionDiffCI(0, 0, 5, 10), { diff: 0, lo: -1, hi: 1 });
  assert.deepEqual(proportionDiffCI(5, 10, 0, 0), { diff: 0, lo: -1, hi: 1 });
});
