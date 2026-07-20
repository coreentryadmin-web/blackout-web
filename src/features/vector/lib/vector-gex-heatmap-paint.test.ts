import { test } from "node:test";
import assert from "node:assert/strict";
import {
  heatmapCellColor,
  bandEdges,
  heatmapRects,
  gexCellAtGridPoint,
  heatmapBucketSecForChartTimeframe,
  normalizeHeatmapBucketSec,
  HEATMAP_TRANSPARENT,
} from "./vector-gex-heatmap-paint";
import type { GexHeatmapGrid } from "./vector-gex-reconstruct";

function rgba(s: string): { r: number; g: number; b: number; a: number } {
  const m = s.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  assert.ok(m, `parseable rgba: ${s}`);
  return { r: +m![1]!, g: +m![2]!, b: +m![3]!, a: +m![4]! };
}

test("heatmapCellColor: call cells emerald-positive, put cells magenta-negative", () => {
  const call = rgba(heatmapCellColor(50, 100));
  const put = rgba(heatmapCellColor(-50, 100));
  assert.deepEqual([call.r, call.g, call.b], [16, 185, 129], "call = emerald #10b981");
  assert.deepEqual([put.r, put.g, put.b], [217, 70, 239], "put = magenta #d946ef");
});

test("heatmapCellColor: alpha scales with |cell|/maxAbs and clamps at 1", () => {
  const weak = rgba(heatmapCellColor(10, 100)).a;
  const strong = rgba(heatmapCellColor(90, 100)).a;
  assert.ok(strong > weak, "heavier gamma → more opaque");
  const atMax = rgba(heatmapCellColor(100, 100)).a;
  const overMax = rgba(heatmapCellColor(500, 100)).a;
  assert.equal(atMax, overMax, "intensity clamps at 1");
  assert.ok(atMax <= 0.55 + 1e-9);
});

test("heatmapCellColor: zero / empty grid / non-finite → transparent", () => {
  assert.equal(heatmapCellColor(0, 100), HEATMAP_TRANSPARENT);
  assert.equal(heatmapCellColor(50, 0), HEATMAP_TRANSPARENT);
  assert.equal(heatmapCellColor(NaN, 100), HEATMAP_TRANSPARENT);
});

test("bandEdges: single resolved coordinate yields min-width band (zoom-safe)", () => {
  const bands = bandEdges([100], 8);
  assert.deepEqual(bands[0], { lo: 92, hi: 108 });
});

test("bandEdges: tiles an increasing axis with contiguous bands", () => {
  const bands = bandEdges([0, 10, 20]);
  assert.deepEqual(bands[0], { lo: -5, hi: 5 });
  assert.deepEqual(bands[1], { lo: 5, hi: 15 });
  assert.deepEqual(bands[2], { lo: 15, hi: 25 });
});

const grid: GexHeatmapGrid = {
  times: [1000, 1300],
  strikes: [7450, 7500, 7550],
  cells: [
    [-80, 0, 40],
    [-20, 0, 100],
  ],
  maxAbs: 100,
  bucketSec: 300,
};

test("heatmapRects: non-zero cells draw; column normalize keeps weak column visible", () => {
  const rects = heatmapRects(grid, (t) => t / 10, (s) => 10000 - s, { normalize: "column" });
  assert.equal(rects.length, 4);
  const weakCol = rects.filter((r) => rgba(r.color).a < 0.15);
  const strongCol = rects.filter((r) => rgba(r.color).a > 0.2);
  assert.ok(weakCol.length > 0 && strongCol.length > 0, "column norm spreads alpha across columns");
});

test("heatmapRects: single visible time column still draws (min band width)", () => {
  const rects = heatmapRects(grid, (t) => (t === 1000 ? 100 : null), (s) => 10000 - s);
  assert.ok(rects.length >= 2, "single x column paints non-zero strike cells");
});

test("gexCellAtGridPoint: nearest cell lookup for crosshair legend", () => {
  const hit = gexCellAtGridPoint(grid, 1010, 7455);
  assert.ok(hit);
  assert.equal(hit!.strike, 7450);
  assert.equal(hit!.value, -80);
});

test("heatmapRects: empty grid → no rects", () => {
  assert.deepEqual(heatmapRects({ times: [], strikes: [], cells: [], maxAbs: 0 }, () => 0, () => 0), []);
});

test("heatmapBucketSecForChartTimeframe: 1–5m → 60s buckets, coarser TFs → 300s", () => {
  assert.equal(heatmapBucketSecForChartTimeframe(1), 60);
  assert.equal(heatmapBucketSecForChartTimeframe(5), 60);
  assert.equal(heatmapBucketSecForChartTimeframe(15), 300);
});

test("normalizeHeatmapBucketSec: accepts 60/120/300, defaults to 300", () => {
  assert.equal(normalizeHeatmapBucketSec(60), 60);
  assert.equal(normalizeHeatmapBucketSec(120), 120);
  assert.equal(normalizeHeatmapBucketSec(300), 300);
  assert.equal(normalizeHeatmapBucketSec("60"), 60);
  assert.equal(normalizeHeatmapBucketSec(null), 300);
  assert.equal(normalizeHeatmapBucketSec(90), 300);
});
