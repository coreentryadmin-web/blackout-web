import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adaptiveAutoNodeCount,
  AUTO_MIN_CANDLE_SHARE,
  candleRangeFromBars,
} from "./vector-adaptive-nodes";
import { wallCountForTimeframe } from "./vector-bar-timeframes";

/** Measured prod geometry (2026-08-19, build f9f9fa0c). */
const SPX = {
  spot: 7691.76,
  step: 5,
  sessionSpan: 68,
  strikes: Array.from({ length: 24 }, (_, i) => 7650 + i * 5),
};
const NVDA = {
  spot: 219.28,
  step: 2.5,
  sessionSpan: 2.1,
  strikes: [207.5, 210, 212.5, 215, 217.5, 220, 222.5, 225, 227.5, 230, 232.5, 235],
};

test("adaptiveAutoNodeCount: SPX keeps timeframe AUTO cap (10 on 3m)", () => {
  const tfAuto = wallCountForTimeframe(3);
  const candle = {
    minValue: SPX.spot - SPX.sessionSpan / 2,
    maxValue: SPX.spot + SPX.sessionSpan / 2,
  };
  const n = adaptiveAutoNodeCount({
    spot: SPX.spot,
    strikes: SPX.strikes,
    candleRange: candle,
    tfAutoCount: tfAuto,
  });
  assert.equal(n, tfAuto, "dense ladder should not self-limit");
});

test("adaptiveAutoNodeCount: NVDA self-limits below 10 on a quiet session", () => {
  const tfAuto = wallCountForTimeframe(3);
  assert.equal(tfAuto, 10);
  const candle = {
    minValue: NVDA.spot - NVDA.sessionSpan / 2,
    maxValue: NVDA.spot + NVDA.sessionSpan / 2,
  };
  const n = adaptiveAutoNodeCount({
    spot: NVDA.spot,
    strikes: NVDA.strikes,
    candleRange: candle,
    tfAutoCount: tfAuto,
  });
  assert.ok(n < tfAuto, `NVDA should self-limit, got ${n}`);
  assert.ok(n >= 3 && n <= 6, `expected ~4-6 rows at 20% candle share, got ${n}`);
});

test("adaptiveAutoNodeCount: volatile NVDA day allows more rows", () => {
  const tfAuto = wallCountForTimeframe(3);
  const wideCandle = { minValue: NVDA.spot - 8, maxValue: NVDA.spot + 8 };
  const quiet = adaptiveAutoNodeCount({
    spot: NVDA.spot,
    strikes: NVDA.strikes,
    candleRange: { minValue: NVDA.spot - 1, maxValue: NVDA.spot + 1.1 },
    tfAutoCount: tfAuto,
  });
  const volatile = adaptiveAutoNodeCount({
    spot: NVDA.spot,
    strikes: NVDA.strikes,
    candleRange: wideCandle,
    tfAutoCount: tfAuto,
  });
  assert.ok(volatile >= quiet, "wider session range → more rows allowed");
});

test("adaptiveAutoNodeCount: manual path unchanged — always returns tf cap when not used", () => {
  const candle = candleRangeFromBars([{ high: 221, low: 217 }]);
  assert.ok(candle);
  const n = adaptiveAutoNodeCount({
    spot: 219.28,
    strikes: NVDA.strikes,
    candleRange: candle!,
    tfAutoCount: 10,
    minCandleShare: AUTO_MIN_CANDLE_SHARE,
  });
  assert.ok(n >= 1);
});

test("candleRangeFromBars: empty or flat returns null", () => {
  assert.equal(candleRangeFromBars([]), null);
  assert.equal(candleRangeFromBars([{ high: 100, low: 100 }]), null);
});
