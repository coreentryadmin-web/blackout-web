import { test } from "node:test";
import assert from "node:assert/strict";
import { buildColumnProfiles, gammaSurfaceRects } from "./vector-gamma-surface-paint";
import type { GexHeatmapGrid } from "./vector-gex-reconstruct";

function rgba(s: string): { r: number; g: number; b: number; a: number } {
  const m = s.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  assert.ok(m, `parseable rgba: ${s}`);
  return { r: +m![1]!, g: +m![2]!, b: +m![3]!, a: +m![4]! };
}

const grid: GexHeatmapGrid = {
  times: [1000, 1300, 1600],
  strikes: [7400, 7450, 7500, 7550, 7600],
  cells: [
    [-50, -30, 0, 20, 60],
    [-40, -20, 0, 30, 70],
    [-60, -10, 0, 40, 80],
  ],
  maxAbs: 80,
};

const flipAt7500 = () => 7500;

test("buildColumnProfiles: aggregates call/put pressure above/below the flip", () => {
  const profiles = buildColumnProfiles(grid, flipAt7500);
  assert.equal(profiles.length, 3);
  for (const p of profiles) {
    assert.equal(p.flipStrike, 7500);
    assert.ok(p.callPressure >= 0, "call pressure non-negative");
    assert.ok(p.putPressure >= 0, "put pressure non-negative");
  }
  // Column 0: calls above flip: strike 7500 (v=0, skip) + 7550 (20) + 7600 (60) = 80
  assert.equal(profiles[0]!.callPressure, 80);
  // Column 0: puts below flip: strike 7400 (-50 → 50) + 7450 (-30 → 30) = 80
  assert.equal(profiles[0]!.putPressure, 80);
});

test("buildColumnProfiles: uses midStrike as fallback when flipAtTime returns null", () => {
  const profiles = buildColumnProfiles(grid, () => null);
  assert.equal(profiles.length, 3);
  // Midpoint: strikes[2] = 7500 → same result as explicit flip=7500
  assert.equal(profiles[0]!.flipStrike, 7500);
});

test("buildColumnProfiles: empty grid → empty profiles", () => {
  const empty: GexHeatmapGrid = { times: [], strikes: [], cells: [], maxAbs: 0 };
  assert.deepEqual(buildColumnProfiles(empty, flipAt7500), []);
});

test("gammaSurfaceRects: produces three zones per time column (call/neutral/put)", () => {
  const rects = gammaSurfaceRects(
    grid,
    (t) => (t - 1000) / 2,
    (s) => 10000 - s,
    flipAt7500
  );
  assert.ok(rects.length > 0, "non-empty output");
  // Each column should produce up to 3 zones; with 3 columns that's up to 9.
  assert.ok(rects.length <= 9, `at most 9 rects, got ${rects.length}`);
  for (const r of rects) {
    assert.ok(r.w > 0, "positive width");
    assert.ok(r.h > 0, "positive height");
    assert.ok(r.color.startsWith("rgba("), `valid rgba: ${r.color}`);
  }
});

test("gammaSurfaceRects: zone colours are gold (call), teal (neutral), crimson (put)", () => {
  const rects = gammaSurfaceRects(
    grid,
    (t) => (t - 1000) / 2,
    (s) => 10000 - s,
    flipAt7500
  );
  const colors = rects.map((r) => rgba(r.color));
  const golds = colors.filter((c) => c.r === 235 && c.g === 170 && c.b === 40);
  const teals = colors.filter((c) => c.r === 20 && c.g === 200 && c.b === 180);
  const crimsons = colors.filter((c) => c.r === 200 && c.g === 45 && c.b === 50);
  assert.ok(golds.length > 0, "has call zones (gold)");
  assert.ok(teals.length > 0, "has neutral zones (teal)");
  assert.ok(crimsons.length > 0, "has put zones (crimson)");
});

test("gammaSurfaceRects: alpha envelope stays within [MIN_ALPHA, MAX_ALPHA]", () => {
  const rects = gammaSurfaceRects(
    grid,
    (t) => (t - 1000) / 2,
    (s) => 10000 - s,
    flipAt7500
  );
  for (const r of rects) {
    const { a } = rgba(r.color);
    assert.ok(a >= 0.04 - 1e-6, `alpha ${a} >= MIN_ALPHA 0.04`);
    assert.ok(a <= 0.38 + 1e-6, `alpha ${a} <= MAX_ALPHA 0.38`);
  }
});

test("gammaSurfaceRects: empty grid → no rects", () => {
  const empty: GexHeatmapGrid = { times: [], strikes: [], cells: [], maxAbs: 0 };
  assert.deepEqual(gammaSurfaceRects(empty, () => 0, () => 0, flipAt7500), []);
});

test("gammaSurfaceRects: unresolvable coordinates → no rects", () => {
  const rects = gammaSurfaceRects(grid, () => null, () => null, flipAt7500);
  assert.equal(rects.length, 0);
});

test("gammaSurfaceRects: all-zero grid → no rects (nothing to draw)", () => {
  const zeroGrid: GexHeatmapGrid = {
    times: [1000, 1300],
    strikes: [7400, 7500, 7600],
    cells: [
      [0, 0, 0],
      [0, 0, 0],
    ],
    maxAbs: 0,
  };
  const rects = gammaSurfaceRects(
    zeroGrid,
    (t) => (t - 1000) / 2,
    (s) => 10000 - s,
    flipAt7500
  );
  assert.equal(rects.length, 0, "zero pressure everywhere → no zones drawn");
});
