import { test } from "node:test";
import assert from "node:assert/strict";
import {
  invalidationBarsFromSeed,
  lastClosedTimeframeBarClose,
  parseInvalidationTimeframeMinutes,
  resolveInvalidationSpot,
} from "./vector-pick-invalidation";

test("parseInvalidationTimeframeMinutes: 5m and 15m and 1H", () => {
  assert.equal(parseInvalidationTimeframeMinutes("5m close > 325"), 5);
  assert.equal(parseInvalidationTimeframeMinutes("15m close < 570"), 15);
  assert.equal(parseInvalidationTimeframeMinutes("1H close > 7600"), 60);
  assert.equal(parseInvalidationTimeframeMinutes("Setup invalidated"), null);
});

test("parseInvalidationTimeframeMinutes: FRACTIONAL hour labels from a custom chart timeframe", () => {
  // `tfLabel` in vector-play-engine.ts emits e.g. "1.5H" for a 90-minute custom candle interval
  // (any whole-minute custom interval up to 240 is selectable — vector-bar-timeframes.ts). The old
  // hour regex `/(\d+)\s*h\b/i` has no decimal-point handling, so `\d+` cannot span the "." and the
  // engine restarts matching AFTER it — "1.5H" was parsed as "5H" (300 minutes) instead of the real
  // 90, and "2.5H"/"3.3H" collapsed to "5H"/"3H" the same way. That feeds straight into
  // `resolveInvalidationSpot` -> `lastClosedTimeframeBarClose`, which then reads the WRONG bar
  // bucket when deciding setup_invalidated on a live Vector pick.
  assert.equal(parseInvalidationTimeframeMinutes("1.5H close < 363.47"), 90);
  assert.equal(parseInvalidationTimeframeMinutes("2.5H close > 100"), 150);
  assert.equal(parseInvalidationTimeframeMinutes("3.3H close > 7600"), 198);
});

test("lastClosedTimeframeBarClose: uses last 1m close inside prior 5m bucket", () => {
  const tf = 5;
  const tfSec = tf * 60;
  const nowMs = (tfSec * 3 + 120) * 1000; // 2 min into bucket 3
  const bucketStart = Math.floor(nowMs / 1000 / tfSec) * tfSec - tfSec;
  const bars = [
    { time: bucketStart, open: 100, high: 101, low: 99, close: 100.5 },
    { time: bucketStart + 60, open: 100.5, high: 102, low: 100, close: 101.2 },
    { time: bucketStart + 120, open: 101.2, high: 103, low: 101, close: 102.0 },
    { time: bucketStart + 180, open: 102, high: 102.5, low: 101.5, close: 101.8 },
    { time: bucketStart + 240, open: 101.8, high: 102, low: 101, close: 101.5 },
  ];
  assert.equal(lastClosedTimeframeBarClose(bars, tf, nowMs), 101.5);
});

test("resolveInvalidationSpot: prefers bar close over noisy live tick", () => {
  const tf = 5;
  const tfSec = tf * 60;
  const nowMs = (tfSec * 2 + 30) * 1000;
  const bucketStart = Math.floor(nowMs / 1000 / tfSec) * tfSec - tfSec;
  const bars = [
    { time: bucketStart, open: 324, high: 325, low: 323, close: 324.2 },
    { time: bucketStart + 60, open: 324.2, high: 324.8, low: 324, close: 324.5 },
  ];
  const spot = resolveInvalidationSpot({
    liveSpot: 325.46,
    invalidation: "5m close > 325",
    bars,
    nowMs,
  });
  assert.equal(spot, 324.5, "bar close should win over tick pierce");
});

test("invalidationBarsFromSeed maps chart bars", () => {
  const out = invalidationBarsFromSeed([{ time: 1000 as never, open: 1, high: 2, low: 0.5, close: 1.5 }]);
  assert.equal(out[0]!.time, 1000);
  assert.equal(out[0]!.close, 1.5);
});
