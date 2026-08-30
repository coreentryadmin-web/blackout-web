import assert from "node:assert/strict";
import { test } from "node:test";
import {
  barBuyPressureRatio,
  volumeAverageLineData,
  volumeHistogramData,
  volumeTrailingSma,
  VECTOR_VOLUME_RVOL_PERIOD,
} from "./vector-volume-render";

test("volumeTrailingSma: null until period samples, then trailing mean", () => {
  const sma = volumeTrailingSma([100, 200, 300, 400], 3);
  assert.deepEqual(sma, [null, null, 200, 300]);
});

test("barBuyPressureRatio: close at top → 1, bottom → 0, flat → 0.5", () => {
  assert.equal(barBuyPressureRatio({ high: 110, low: 100, close: 110 }), 1);
  assert.equal(barBuyPressureRatio({ high: 110, low: 100, close: 100 }), 0);
  assert.equal(barBuyPressureRatio({ high: 100, low: 100, close: 100 }), 0.5);
});

test("volumeHistogramData relative: climax bar gets amber, quiet bar dim gray", () => {
  const bars = Array.from({ length: 25 }, (_, i) => ({
    time: 1_700_000_000 + i * 60,
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 1_000_000,
  }));
  bars[24] = { ...bars[24]!, volume: 4_000_000 };
  const hist = volumeHistogramData(bars, "relative", false);
  assert.equal(hist.length, 25);
  assert.match(hist[24]!.color!, /251,\s*191,\s*36/);
  assert.match(hist[0]!.color!, /56,\s*189,\s*248/);
});

test("volumeHistogramData pressure: close near high → green tint, near low → red", () => {
  const bars = [
    { time: 1, open: 100, high: 110, low: 100, close: 109, volume: 500_000 },
    { time: 2, open: 100, high: 110, low: 100, close: 101, volume: 500_000 },
  ];
  const hist = volumeHistogramData(bars, "pressure", false);
  assert.match(hist[0]!.color!, /0,\s*230,\s*118/);
  assert.match(hist[1]!.color!, /255,\s*45,\s*85/);
});

test("volumeAverageLineData: emits SMA points after warm-up", () => {
  const bars = Array.from({ length: VECTOR_VOLUME_RVOL_PERIOD + 2 }, (_, i) => ({
    time: i,
    open: 1,
    high: 2,
    low: 0,
    close: 1,
    volume: 100,
  }));
  const line = volumeAverageLineData(bars);
  assert.equal(line.length, bars.length - VECTOR_VOLUME_RVOL_PERIOD + 1);
  assert.equal(line[0]!.value, 100);
});
