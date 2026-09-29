import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emaFromCloses,
  classifyRegimeLabel,
  buildRegimeByDateMap,
  classifyVolLabel,
  median,
} from "./banger-regime-classify.mjs";

function makeCloses(n, start, stepPct) {
  const out = [];
  let v = start;
  for (let i = 0; i < n; i++) {
    out.push(v);
    v = v * (1 + stepPct / 100);
  }
  return out;
}

test("emaFromCloses: too few bars -> null", () => {
  assert.equal(emaFromCloses([1, 2, 3], 20), null);
});

test("emaFromCloses: a flat series' EMA converges to the flat value", () => {
  const closes = Array(60).fill(100);
  assert.equal(Math.round(emaFromCloses(closes, 20)), 100);
});

test("classifyRegimeLabel: fewer than 55 bars -> null (absent, never fabricated)", () => {
  assert.equal(classifyRegimeLabel(makeCloses(30, 100, 0.5)), null);
});

test("classifyRegimeLabel: a steady uptrend -> BULL", () => {
  const closes = makeCloses(80, 100, 0.6); // steady +0.6%/day compounding uptrend
  assert.equal(classifyRegimeLabel(closes), "BULL");
});

test("classifyRegimeLabel: a steady downtrend -> BEAR", () => {
  const closes = makeCloses(80, 100, -0.6);
  assert.equal(classifyRegimeLabel(closes), "BEAR");
});

test("classifyRegimeLabel: a mixed signal (long decline then a sharp recent uptick, so the flags disagree) -> SIDEWAYS, never forced to BULL/BEAR", () => {
  const closes = [];
  let v = 100;
  for (let i = 0; i < 70; i++) {
    closes.push(v);
    v *= 0.995; // a longer, gentle decline
  }
  for (let i = 0; i < 10; i++) {
    closes.push(v);
    v *= 1.02; // a sharp recent uptick that pulls price above the 20-EMA but not the whole stack
  }
  assert.equal(classifyRegimeLabel(closes), "SIDEWAYS");
});

test("buildRegimeByDateMap: never leaks a future bar into an earlier date's label", () => {
  const uptrend = makeCloses(80, 100, 0.6);
  const bars = uptrend.map((c, i) => ({ t: Date.UTC(2026, 0, 1 + i), c }));
  const map = buildRegimeByDateMap(bars);
  // The early dates (fewer than 55 bars seen so far) must be null/absent, not BULL --
  // proving the map is built incrementally, not from the whole series at once.
  const firstDateKey = new Date(bars[10].t).toISOString().slice(0, 10);
  assert.equal(map.get(firstDateKey), null);
  const lastDateKey = new Date(bars.at(-1).t).toISOString().slice(0, 10);
  assert.equal(map.get(lastDateKey), "BULL");
});

test("median: odd and even length arrays", () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
});

test("classifyVolLabel: split at the median", () => {
  const med = median([12, 14, 16, 18, 20]);
  assert.equal(classifyVolLabel(20, med), "HIGH_VOL");
  assert.equal(classifyVolLabel(12, med), "LOW_VOL");
  assert.equal(classifyVolLabel(med, med), "HIGH_VOL"); // ties resolve to HIGH_VOL (>=)
});
