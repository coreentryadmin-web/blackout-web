import test from "node:test";
import assert from "node:assert/strict";
import { correlate, bucketCalibration, informationCheck, mean, stdev } from "./calibration-eval.mjs";

test("a CONSTANT predictor is degenerate, not 'r = 0' and not NaN", () => {
  // This is the whole point. SPX Slayer's confidence is 96 on all 51 committed plays; a naive
  // point-biserial prints NaN, which a reader skims as "no signal found" rather than
  // "the input never varies".
  const r = correlate([96, 96, 96, 96], [1, 0, 1, 0]);
  assert.equal(r.verdict, "degenerate_predictor");
  assert.equal(r.constant, 96);
  assert.ok(!("r" in r), "must not report a number for a constant input");
});

test("a constant OUTCOME is a different degenerate case with a different remedy", () => {
  const r = correlate([10, 20, 30, 40], [1, 1, 1, 1]);
  assert.equal(r.verdict, "degenerate_outcome");
});

test("both constant is named as such", () => {
  assert.equal(correlate([5, 5], [1, 1]).verdict, "degenerate_both");
});

test("a real correlation is computed and signed correctly", () => {
  const r = correlate([1, 2, 3, 4, 5, 6], [0, 0, 0, 1, 1, 1]);
  assert.equal(r.verdict, "ok");
  assert.ok(r.r > 0.8, `expected strong positive, got ${r.r}`);
  const inv = correlate([1, 2, 3, 4, 5, 6], [1, 1, 1, 0, 0, 0]);
  assert.ok(inv.r < -0.8);
});

test("under 2 samples is insufficient, never a correlation", () => {
  assert.equal(correlate([1], [1]).verdict, "insufficient_sample");
  assert.equal(correlate([], []).verdict, "insufficient_sample");
});

test("every bucket carries its denominator, and thin buckets are flagged not hidden", () => {
  const rows = [
    { c: 50, w: true }, { c: 55, w: false }, { c: 60, w: true },
    { c: 95, w: true }, { c: 96, w: true }, { c: 96, w: false },
  ];
  const out = bucketCalibration(rows, {
    value: (r) => r.c,
    isWin: (r) => r.w,
    buckets: [[0, 79], [80, 100]],
    minSample: 4,
  });
  assert.deepEqual(out.map((b) => [b.n, b.wins]), [[3, 2], [3, 2]]);
  assert.ok(out.every((b) => b.insufficient_sample), "n=3 under minSample 4 must be flagged");
  assert.equal(out[0].win_rate, 2 / 3);
});

test("an empty bucket reports win_rate null, never 0 — 0% is a measurement", () => {
  const out = bucketCalibration([{ c: 5, w: true }], {
    value: (r) => r.c, isWin: (r) => r.w, buckets: [[90, 100]],
  });
  assert.equal(out[0].n, 0);
  assert.equal(out[0].win_rate, null);
});

test("informationCheck names a constant predictor outright", () => {
  const c = informationCheck([96, 96, 96, 96, 96]);
  assert.equal(c.uninformative, true);
  assert.equal(c.distinct_values, 1);
  assert.equal(c.constant, 96);

  const varied = informationCheck([50, 60, 96]);
  assert.equal(varied.uninformative, false);
  assert.equal(varied.constant, null);
});

test("mean of an empty set is null, not 0", () => {
  assert.equal(mean([]), null);
  assert.equal(stdev([]), null);
  assert.equal(mean([2, 4]), 3);
});
