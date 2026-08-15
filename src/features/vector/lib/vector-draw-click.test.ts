import assert from "node:assert/strict";
import test from "node:test";
import { resolveChartClickTime } from "./vector-draw-click";

test("resolveChartClickTime: prefers param.time when present", () => {
  const chart = {
    timeScale: () => ({
      coordinateToTime: () => 999,
      coordinateToLogical: () => 5,
    }),
  } as Parameters<typeof resolveChartClickTime>[0];

  const t = resolveChartClickTime(
    chart,
    { point: { x: 100, y: 200 }, time: 1_700_000_000 as never, seriesData: new Map() },
    [{ time: 1_700_000_100 }]
  );
  assert.equal(t, 1_700_000_000);
});

test("resolveChartClickTime: maps x coordinate when time absent", () => {
  const chart = {
    timeScale: () => ({
      coordinateToTime: (x: number) => (x === 400 ? 1_700_000_500 : null),
      coordinateToLogical: () => null,
    }),
  } as Parameters<typeof resolveChartClickTime>[0];

  const t = resolveChartClickTime(
    chart,
    { point: { x: 400, y: 200 }, time: undefined, seriesData: new Map() },
    []
  );
  assert.equal(t, 1_700_000_500);
});

test("resolveChartClickTime: falls back to nearest bar via logical index", () => {
  const bars = [{ time: 100 }, { time: 200 }, { time: 300 }];
  const chart = {
    timeScale: () => ({
      coordinateToTime: () => null,
      coordinateToLogical: () => 1.4,
    }),
  } as Parameters<typeof resolveChartClickTime>[0];

  const t = resolveChartClickTime(
    chart,
    { point: { x: 50, y: 50 }, time: undefined, seriesData: new Map() },
    bars
  );
  assert.equal(t, 200);
});
