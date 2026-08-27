import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

test("resolveChartClickTime: logical-index fallback must be indexed against the DISPLAYED (aggregated) series, not raw minute bars", () => {
  // This is the exact defect fixed 2026-08-27: coordinateToLogical() returns an index into
  // whatever series is currently plotted on the chart. At any timeframe above 1m that series is
  // shorter than the raw 1-minute bar history, so indexing raw minute bars with this logical index
  // silently resolves to the wrong bar (and therefore the wrong click time) whenever the user
  // clicks in the empty chart margin (before the first bar, or past the last one) at a coarsened
  // timeframe. Simulate a 15m chart (26 displayed bars over an RTH session) vs. the underlying
  // 390 raw 1-minute bars: a click past the last displayed candle must resolve against the last
  // DISPLAYED bar's time, not the 26th raw minute bar.
  const displayed15mBars = Array.from({ length: 26 }, (_, i) => ({ time: 34_200 + i * 900 })); // 9:30-3:45pm ET, 15m step
  const raw1mBars = Array.from({ length: 390 }, (_, i) => ({ time: 34_200 + i * 60 })); // same session, 1m step

  const chart = {
    timeScale: () => ({
      coordinateToTime: () => null,
      coordinateToLogical: () => 25, // last displayed 15m bar's index
    }),
  } as Parameters<typeof resolveChartClickTime>[0];

  const param = { point: { x: 900, y: 50 }, time: undefined, seriesData: new Map() };

  const correct = resolveChartClickTime(chart, param, displayed15mBars);
  assert.equal(correct, displayed15mBars[25]!.time);

  // The bug: passing raw minute bars for the same logical index lands hours off.
  const buggy = resolveChartClickTime(chart, param, raw1mBars);
  assert.equal(buggy, raw1mBars[25]!.time);
  assert.notEqual(buggy, correct);
});

test("guard: the drawings hook resolves click time against the displayed/aggregated bars, not raw minute bars", () => {
  const src = readFileSync(
    join(process.cwd(), "src/features/vector/lib/use-vector-chart-drawings.ts"),
    "utf8"
  );
  assert.match(src, /resolveChartClickTime\(chart, param, displayBarsRef\.current/);
});
