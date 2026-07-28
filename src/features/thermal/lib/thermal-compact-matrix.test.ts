import assert from "node:assert/strict";
import test from "node:test";
import {
  bandStrikesAroundSpot,
  compactMatrixPeak,
  fmtCompactExpiry,
  fmtCompactHeatMoney,
  resolveCompactExpiries,
} from "./thermal-compact-matrix.ts";

test("fmtCompactExpiry → M/D", () => {
  assert.equal(fmtCompactExpiry("2026-07-28"), "7/28");
  assert.equal(fmtCompactExpiry("2026-12-01"), "12/1");
});

test("resolveCompactExpiries prefers near-term and caps", () => {
  const near = ["2026-07-28", "2026-07-29", "2026-07-30"];
  const all = [...near, "2026-09-18", "2026-12-18"];
  assert.deepEqual(resolveCompactExpiries(near, all, 2), ["2026-07-28", "2026-07-29"]);
  assert.deepEqual(resolveCompactExpiries([], all, 2), ["2026-07-28", "2026-07-29"]);
});

test("bandStrikesAroundSpot centers on nearest strike", () => {
  const strikes = [100, 101, 102, 103, 104, 105, 106];
  assert.deepEqual(bandStrikesAroundSpot(strikes, 103.4, 1), [102, 103, 104]);
  assert.deepEqual(bandStrikesAroundSpot([], 100, 2), []);
});

test("compare desk strike band (~28 half-width) is long enough to read like major matrix", () => {
  const strikes = Array.from({ length: 80 }, (_, i) => 100 + i);
  const band = bandStrikesAroundSpot(strikes, 140, 28);
  assert.equal(band.length, 57); // 28 below + spot + 28 above
  assert.ok(band.includes(140));
  assert.equal(band[0], 112);
  assert.equal(band[band.length - 1], 168);
});

test("fmtCompactHeatMoney dense labels", () => {
  assert.equal(fmtCompactHeatMoney(0), "·");
  assert.equal(fmtCompactHeatMoney(2_500_000), "+2.5M");
  assert.equal(fmtCompactHeatMoney(-150_000), "−150K");
});

test("compactMatrixPeak uses absolute max in window", () => {
  const cells = {
    "100": { "2026-07-28": 10, "2026-07-29": -40 },
    "101": { "2026-07-28": 25 },
  };
  assert.equal(compactMatrixPeak(cells, [100, 101], ["2026-07-28", "2026-07-29"]), 40);
});
