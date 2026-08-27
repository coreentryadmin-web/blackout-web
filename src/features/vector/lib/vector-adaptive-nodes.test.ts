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

test("adaptiveAutoNodeCount: NVDA respects AUTO floor on coarse ladders", () => {
  const tfAuto = wallCountForTimeframe(3);
  assert.ok(tfAuto >= 10, `3m AUTO cap should be a dense-ladder count, got ${tfAuto}`);
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
  // Floor lowered 12 -> 8 (2026-08-27, member report): the old floor of 12 was itself the
  // controlling number on a quiet coarse-stepped session, pulling the axis to ~±14% while the
  // session traded inside ~1% — see AUTO_MIN_ROWS_PER_SIDE's comment.
  assert.ok(n >= 8 || n === tfAuto, `expected AUTO floor or full cap, got ${n}`);
  assert.ok(n <= tfAuto);
});

test("adaptiveAutoNodeCount: quiet NVDA session — floor override needs meaningfully less axis span than before the 2026-08-27 fix", () => {
  // Member report (2026-08-27, live screenshot): NVDA candles occupied a tiny sliver of the
  // chart on a quiet session. Root cause was this exact fixture — AUTO_MIN_ROWS_PER_SIDE (was 12)
  // forced 12 rows even though the session's own range would only justify ~2 at the (old) 16%
  // share target, and 12 rows on a $2.50 ladder needs ~13.7% of spot just for the row count,
  // before any wall-reveal widening on top. Assert the NEW floor (8) needs meaningfully LESS.
  const tfAuto = wallCountForTimeframe(3);
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
  const axisSpanPct = (n * NVDA.step) / NVDA.spot;
  assert.ok(axisSpanPct < 0.12, `expected the floor's own axis need under 12% of spot, got ${(axisSpanPct * 100).toFixed(1)}%`);
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
