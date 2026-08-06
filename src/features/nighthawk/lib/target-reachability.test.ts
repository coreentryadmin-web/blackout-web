// Target-reachability table tests — the interpolation, the honesty guards (clamp, never
// extrapolate; null rather than a fabricated figure), and a structural guard on the table
// itself so a bad edit to the measured constants cannot ship silently.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REACHABILITY_FLOOR_PCT,
  TARGET_ATR_HISTOGRAM_EDGES,
  TARGET_REACHABILITY_TABLE,
  formatReachabilityPct,
  targetAtrHistogram,
  targetReachabilityNote,
  targetReachabilityPct,
} from "./target-reachability";

test("the measured table is monotonically decreasing in k (a farther target is a subset)", () => {
  // Structural, not cosmetic: P(touch ≥ K) is a survival function, so a non-monotonic
  // edit is a measurement error by construction. This is the tripwire on the constants.
  for (let i = 1; i < TARGET_REACHABILITY_TABLE.length; i++) {
    const prev = TARGET_REACHABILITY_TABLE[i - 1]!;
    const cur = TARGET_REACHABILITY_TABLE[i]!;
    assert.ok(cur.k > prev.k, `k must strictly increase: ${prev.k} → ${cur.k}`);
    assert.ok(cur.pct <= prev.pct, `pct must not increase with k: ${prev.pct} → ${cur.pct}`);
    assert.ok(cur.pct >= 0 && cur.pct <= 100, `pct out of range: ${cur.pct}`);
  }
});

test("targetReachabilityPct returns the measured value at every measured point", () => {
  for (const { k, pct } of TARGET_REACHABILITY_TABLE) {
    assert.equal(targetReachabilityPct(k), pct, `k=${k}`);
  }
});

test("targetReachabilityPct interpolates linearly between measured points", () => {
  // Midway 0.5×(38%) → 0.75×(21%) is 0.625× → 29.5%.
  assert.equal(targetReachabilityPct(0.625), 29.5);
  // Midway 1.0×(11%) → 1.25×(5.5%) is 1.125× → 8.25%.
  assert.ok(Math.abs(targetReachabilityPct(1.125)! - 8.25) < 1e-9);
  // Quarter of the way 1.5×(3.0%) → 2.0×(0.9%) is 1.625× → 3.0 − 0.25×2.1 = 2.475%.
  assert.ok(Math.abs(targetReachabilityPct(1.625)! - 2.475) < 1e-9);
});

test("targetReachabilityPct CLAMPS outside the measured range — never extrapolates", () => {
  // Below the nearest measured point: clamp to 65%, do NOT run toward 100%.
  assert.equal(targetReachabilityPct(0.1), 65);
  assert.equal(targetReachabilityPct(0), 65);
  // Beyond the farthest: clamp to the floor value, do NOT run negative.
  assert.equal(targetReachabilityPct(3.5), 0.1);
  assert.equal(targetReachabilityPct(8.23), 0.1); // AVGO 2026-07-09, the worst real play
  assert.ok(targetReachabilityPct(100)! >= 0);
});

test("targetReachabilityPct refuses unusable input rather than guessing", () => {
  assert.equal(targetReachabilityPct(Number.NaN), null);
  assert.equal(targetReachabilityPct(Number.POSITIVE_INFINITY), null);
  assert.equal(targetReachabilityPct(-1), null);
});

test("formatReachabilityPct floors sub-1% at '<1%' instead of printing false precision", () => {
  assert.equal(formatReachabilityPct(2.0), `<${REACHABILITY_FLOOR_PCT}%`); // 0.9%
  assert.equal(formatReachabilityPct(3.5), `<${REACHABILITY_FLOOR_PCT}%`); // 0.1%
  assert.equal(formatReachabilityPct(1.5), "~3%"); // 3.0% — one decimal below 10%, trailing .0 dropped
  assert.equal(formatReachabilityPct(1.25), "~5.5%");
  assert.equal(formatReachabilityPct(0.5), "~38%"); // whole number at/above 10%
  assert.equal(formatReachabilityPct(Number.NaN), null);
});

test("targetReachabilityNote renders the member sentence, or nothing at all", () => {
  // The shipped floor-push class: 1.5× ATR is a 3% one-session proposition.
  const floorPush = targetReachabilityNote(1.5)!;
  assert.match(floorPush, /1\.5× ATR14/);
  assert.match(floorPush, /~3%/);
  // A gate-bar-grazing target reads honestly as sub-1%.
  assert.match(targetReachabilityNote(3.5)!, /<1%/);
  // Never a fabricated sentence on unusable input.
  assert.equal(targetReachabilityNote(Number.NaN), null);
  assert.equal(targetReachabilityNote(-2), null);
});

test("targetAtrHistogram buckets pinned multiples, straddling the 1.5 floor and the 3.5 gate", () => {
  const bins = targetAtrHistogram([
    0.4, // 0–1.0
    1.1, 1.49, // 1.0–1.5  (the floor-push class: 1.5×ATR minus the 0.4×ATR band half-width)
    1.55, // 1.5–2.0
    2.05, 2.4, // 2.0–2.5
    3.65, // 3.5+ (MSFT 2026-07-29, gate_promoted)
    8.23, // 3.5+ (AVGO 2026-07-09)
  ]);
  // Bins: [0,1) [1,1.5) [1.5,2) [2,2.5) [2.5,3) [3,3.5) [3.5,5) [5,∞)
  assert.deepEqual(
    bins.map((b) => b.n),
    [1, 2, 1, 2, 0, 0, 1, 1]
  );
  assert.equal(bins.length, TARGET_ATR_HISTOGRAM_EDGES.length);
  assert.equal(bins[bins.length - 1]!.to, null, "top bin is open-ended");
  assert.equal(bins[0]!.from, 0);
  // Percentages over the USABLE count (8), one decimal.
  assert.equal(bins[1]!.pct, 25);
  assert.equal(bins.reduce((a, b) => a + b.n, 0), 8);
});

test("targetAtrHistogram ignores unusable values rather than bucketing them into 0", () => {
  const bins = targetAtrHistogram([2.0, null, undefined, Number.NaN, -1, Number.POSITIVE_INFINITY]);
  assert.equal(bins.reduce((a, b) => a + b.n, 0), 1, "only the one real multiple counts");
  assert.equal(bins[0]!.n, 0, "junk must NOT land in the 0–1.0 bin");
  assert.equal(bins[3]!.n, 1); // 2.0 → the 2.0–2.5 bin
});

test("targetAtrHistogram on an empty population reports null percentages, never 0%", () => {
  const bins = targetAtrHistogram([]);
  assert.equal(bins.every((b) => b.n === 0), true);
  assert.equal(bins.every((b) => b.pct === null), true);
});
