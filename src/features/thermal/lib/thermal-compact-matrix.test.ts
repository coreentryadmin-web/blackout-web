import assert from "node:assert/strict";
import test from "node:test";
import {
  bandStrikesAroundSpot,
  compactMatrixPeak,
  compactPerExpiryExtremes,
  compactPerExpiryTopHighlights,
  fmtCompactExpiry,
  fmtCompactHeatMoney,
  nearestStrikeIndex,
  resolveCompactExpiries,
  resolveZeroDteExpiry,
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

test("compare desk strike band (~36 half-width) is a tall near-term ladder", () => {
  const strikes = Array.from({ length: 100 }, (_, i) => 100 + i);
  const band = bandStrikesAroundSpot(strikes, 150, 36);
  assert.equal(band.length, 73); // 36 below + spot + 36 above
  assert.ok(band.includes(150));
  assert.equal(band[0], 114);
  assert.equal(band[band.length - 1], 186);
  // Spot is mid-band — without auto-center, scrollTop=0 leaves price off-screen.
  assert.equal(nearestStrikeIndex(band, 150), 36);
});

test("resolveZeroDteExpiry prefers today when on axis, else earliest", () => {
  const near = ["2026-07-28", "2026-07-29", "2026-07-30"];
  assert.equal(resolveZeroDteExpiry(near, near, "2026-07-28"), "2026-07-28");
  assert.equal(resolveZeroDteExpiry(near, near, "2026-07-31"), "2026-07-28");
  assert.equal(resolveZeroDteExpiry([], [], "2026-07-28"), null);
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

test("compactPerExpiryExtremes marks +node yellow side, −node purple side, king by |mag|", () => {
  const cells = {
    "100": { "2026-07-28": 10 },
    "101": { "2026-07-28": 50 },
    "102": { "2026-07-28": -80 },
    "103": { "2026-07-28": -20 },
  };
  const ex = compactPerExpiryExtremes(cells, [100, 101, 102, 103], ["2026-07-28"]);
  assert.equal(ex["2026-07-28"]?.callWall, 101);
  assert.equal(ex["2026-07-28"]?.putWall, 102);
  assert.equal(ex["2026-07-28"]?.king, 102); // |−80| > |50|
});

test("compactPerExpiryTopHighlights ranks top 4 positive and negative per expiry", () => {
  const cells = {
    "100": { "2026-07-28": 10 },
    "101": { "2026-07-28": 50 },
    "102": { "2026-07-28": 40 },
    "103": { "2026-07-28": 30 },
    "104": { "2026-07-28": 20 },
    "105": { "2026-07-28": 5 },
    "106": { "2026-07-28": -80 },
    "107": { "2026-07-28": -60 },
    "108": { "2026-07-28": -40 },
    "109": { "2026-07-28": -25 },
    "110": { "2026-07-28": -10 },
    "111": { "2026-07-28": -5 },
  };
  const hl = compactPerExpiryTopHighlights(
    cells,
    [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111],
    ["2026-07-28"],
  );
  const day = hl["2026-07-28"]!;
  assert.deepEqual(day.topPositive, { 101: 1, 102: 2, 103: 3, 104: 4 });
  assert.deepEqual(day.topNegative, { 106: 1, 107: 2, 108: 3, 109: 4 });
  assert.equal(day.topPositive[105], undefined);
  assert.equal(day.topNegative[111], undefined);
});
