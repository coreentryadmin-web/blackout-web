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
