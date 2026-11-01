import test from "node:test";
import assert from "node:assert/strict";
import { detectDevelopingPressure, type PressureBar } from "./early-entry-pressure.ts";

function bar(i: number, h: number, l: number, c: number, v = 1000): PressureBar {
  return { t: i, h, l, c, v };
}

/** 60 lookback bars establishing a LONG-setup level at 110 (one bar reaches h=110, the rest of
 *  the lookback window is a wide, noisy range), then 15 compression bars coiling tightly just
 *  under 110, touching it (within tolerance) on bars 2 and 9 without ever closing through it. */
function longCoilBars(): PressureBar[] {
  const lookback: PressureBar[] = [];
  for (let i = 0; i < 59; i++) lookback.push(bar(i, 103 + (i % 3), 95, 100));
  lookback.push(bar(59, 110, 100, 105)); // establishes the level
  const compression: PressureBar[] = [];
  for (let i = 60; i < 75; i++) {
    const touchesLevel = i === 62 || i === 69;
    compression.push(bar(i, touchesLevel ? 109.85 : 109.3, 108.8, 109.1));
  }
  return [...lookback, ...compression];
}

function shortCoilBars(): PressureBar[] {
  const lookback: PressureBar[] = [];
  for (let i = 0; i < 59; i++) lookback.push(bar(i, 105, 97 - (i % 3), 100));
  lookback.push(bar(59, 100, 90, 95)); // establishes the level (low = 90)
  const compression: PressureBar[] = [];
  for (let i = 60; i < 75; i++) {
    const touchesLevel = i === 62 || i === 69;
    compression.push(bar(i, 91.2, touchesLevel ? 90.13 : 90.7, 90.9));
  }
  return [...lookback, ...compression];
}

test("detectDevelopingPressure: not enough bars -> developing=false, honest nulls", () => {
  const r = detectDevelopingPressure({ bars: [bar(0, 101, 99, 100)], direction: "long", rvolRatio: 2 });
  assert.equal(r.developing, false);
  assert.equal(r.compression, null);
  assert.equal(r.level, null);
  assert.equal(r.level_tests, 0);
  assert.equal(r.distance_to_level_pct, null);
});

test("detectDevelopingPressure: a clean LONG coil with confirmed RVOL and 2 level tests -> developing", () => {
  const r = detectDevelopingPressure({ bars: longCoilBars(), direction: "long", rvolRatio: 2.0 });
  assert.equal(r.developing, true);
  assert.equal(r.level, 110);
  assert.equal(r.level_tests, 2);
  assert.ok(r.compression?.compressed);
  assert.ok(r.rvol_confirmed);
  assert.ok(r.distance_to_level_pct! > 0, "still below the level -- positive distance for a long setup");
});

test("detectDevelopingPressure: a clean SHORT coil with confirmed RVOL and 2 level tests -> developing", () => {
  const r = detectDevelopingPressure({ bars: shortCoilBars(), direction: "short", rvolRatio: 2.0 });
  assert.equal(r.developing, true);
  assert.equal(r.level, 90);
  assert.equal(r.level_tests, 2);
  assert.ok(r.distance_to_level_pct! > 0, "still above the level -- positive distance for a short setup");
});

test("detectDevelopingPressure: compression + level tests present but RVOL below floor -> NOT developing", () => {
  const r = detectDevelopingPressure({ bars: longCoilBars(), direction: "long", rvolRatio: 1.0 });
  assert.equal(r.rvol_confirmed, false);
  assert.equal(r.developing, false);
  assert.ok(r.compression?.compressed, "the underlying coil itself is still reported honestly");
});

test("detectDevelopingPressure: fewer than minLevelTests touches -> NOT developing", () => {
  const bars = longCoilBars();
  // Flatten the SECOND touch (index 69, offset 60 into the array) so only one real touch remains.
  const idx = bars.findIndex((b) => b.t === 69);
  bars[idx] = { ...bars[idx]!, h: 109.3 };
  const r = detectDevelopingPressure({ bars, direction: "long", rvolRatio: 2.0 });
  assert.equal(r.level_tests, 1);
  assert.equal(r.developing, false);
});

test("detectDevelopingPressure: perfectly FLAT data (zero baseline range) never reads as a coil, even though its own tiny range clears the absolute ceiling", () => {
  const flat: PressureBar[] = Array.from({ length: 75 }, (_, i) => bar(i, 100, 100, 100));
  const r = detectDevelopingPressure({ bars: flat, direction: "long", rvolRatio: 2.0 });
  assert.equal(r.compression?.compressed, false, "a zero baseline range is not a real swing to compress FROM");
  assert.equal(r.developing, false);
});

test("detectDevelopingPressure: a wide, non-compressing recent range -> NOT developing even with RVOL+tests", () => {
  const bars = longCoilBars();
  const widened = bars.map((b) => (b.t >= 60 ? { ...b, l: 95 } : b)); // blow out the compression-window low
  const r = detectDevelopingPressure({ bars: widened, direction: "long", rvolRatio: 2.0 });
  assert.equal(r.compression?.compressed, false);
  assert.equal(r.developing, false);
});

test("detectDevelopingPressure: order_flow_bias is positive when up-bars dominate the compression window", () => {
  const bars: PressureBar[] = [];
  for (let i = 0; i < 59; i++) bars.push(bar(i, 103, 95, 100));
  bars.push(bar(59, 110, 100, 105));
  for (let i = 60; i < 75; i++) bars.push(bar(i, 109, 108, 108 + i * 0.01)); // monotonically rising closes
  const r = detectDevelopingPressure({ bars, direction: "long", rvolRatio: 2.0 });
  assert.ok(r.order_flow_bias! > 0, `expected a positive order-flow bias, got ${r.order_flow_bias}`);
});

test("detectDevelopingPressure: order_flow_bias is negative when down-bars dominate", () => {
  const bars: PressureBar[] = [];
  for (let i = 0; i < 59; i++) bars.push(bar(i, 103, 95, 100));
  bars.push(bar(59, 110, 100, 105));
  for (let i = 60; i < 75; i++) bars.push(bar(i, 109, 108, 109 - i * 0.01)); // monotonically falling closes
  const r = detectDevelopingPressure({ bars, direction: "long", rvolRatio: 2.0 });
  assert.ok(r.order_flow_bias! < 0, `expected a negative order-flow bias, got ${r.order_flow_bias}`);
});

test("detectDevelopingPressure: unsorted input bars are sorted internally (order never matters to the caller)", () => {
  const sortedBars = longCoilBars();
  const shuffled = [...sortedBars].reverse();
  const a = detectDevelopingPressure({ bars: sortedBars, direction: "long", rvolRatio: 2.0 });
  const b = detectDevelopingPressure({ bars: shuffled, direction: "long", rvolRatio: 2.0 });
  assert.deepEqual(a, b);
});

test("detectDevelopingPressure: a caller-supplied rvolFloor changes the confirmation bar", () => {
  const r = detectDevelopingPressure({ bars: longCoilBars(), direction: "long", rvolRatio: 1.2, rvolFloor: 1.0 });
  assert.equal(r.rvol_confirmed, true);
  assert.equal(r.developing, true);
});
