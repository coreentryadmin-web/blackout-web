import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  IChartApi,
  ISeriesApi,
  SeriesType,
  Time,
  SeriesAttachedParameter,
} from "lightweight-charts";
import { GexHeatmapPrimitive } from "./vector-gex-heatmap-primitive";

/**
 * Minimal stub chart/series — just enough surface for the primitive's `attached()` + the two
 * coordinate-mapping calls it makes (`timeToCoordinate` / `priceToCoordinate`). No DOM/canvas
 * needed: `paneViews()[0].renderer()` is driven directly, the same behavioral-testing technique
 * used elsewhere in this directory for other `ISeriesPrimitive` classes.
 */
function attachStub(prim: GexHeatmapPrimitive): void {
  const chart = {
    timeScale: () => ({
      timeToCoordinate: (t: unknown) => (typeof t === "number" ? t : null),
    }),
  } as unknown as IChartApi;
  const series = {
    priceToCoordinate: (p: number) => 300 - p,
  } as unknown as ISeriesApi<SeriesType, Time>;
  prim.attached({
    chart,
    series,
    requestUpdate: () => {},
  } as unknown as SeriesAttachedParameter<Time>);
}

test("toggle OFF draws nothing, even mid-tick with a live spot already set", () => {
  // The live-tick handler in VectorChart.tsx pushes `setSpot()` on EVERY tick unconditionally —
  // independent of whether the member has the "gex-heatmap" toggle on — so `_spot` is routinely
  // fresh while `_visible` is false. The toggle must still fully hide the surface, per this file's
  // own documented contract ("visible === false makes renderer() return null → nothing is drawn").
  const prim = new GexHeatmapPrimitive();
  attachStub(prim);
  prim.setData(null, false); // toggle OFF, no grid
  prim.setSpot(105); // a live tick still arrives
  const renderer = prim.paneViews()[0]!.renderer();
  assert.equal(renderer, null, "no renderer (and so no spot guide line) while the toggle is OFF");
});

test("toggle OFF still hides the surface even once a grid was previously loaded", () => {
  const grid = {
    times: [1, 2],
    strikes: [100, 101],
    cells: [
      [10, 0],
      [0, -10],
    ],
    maxAbs: 10,
  };
  const prim = new GexHeatmapPrimitive();
  attachStub(prim);
  prim.setData(grid as never, true);
  prim.setSpot(105);
  assert.ok(prim.paneViews()[0]!.renderer(), "sanity: renders while ON");
  prim.setData(grid as never, false); // member flips the toggle OFF; grid ref is untouched
  const renderer = prim.paneViews()[0]!.renderer();
  assert.equal(renderer, null, "toggling OFF hides everything, including the still-fresh spot line");
});

test("toggle ON with real rects and a live spot renders both", () => {
  const grid = {
    times: [1, 2],
    strikes: [100, 101],
    cells: [
      [10, 0],
      [0, -10],
    ],
    maxAbs: 10,
  };
  const prim = new GexHeatmapPrimitive();
  attachStub(prim);
  prim.setData(grid as never, true);
  prim.setSpot(105);
  const renderer = prim.paneViews()[0]!.renderer();
  assert.ok(renderer, "renders when visible with real data + spot");
});

test("isVisible() mirrors the last setData toggle state", () => {
  const prim = new GexHeatmapPrimitive();
  attachStub(prim);
  assert.equal(prim.isVisible(), false, "starts OFF");
  prim.setData(null, true);
  assert.equal(prim.isVisible(), true);
  prim.setData(null, false);
  assert.equal(prim.isVisible(), false);
});
