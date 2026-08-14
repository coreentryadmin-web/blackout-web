import { test } from "node:test";
import assert from "node:assert/strict";
import {
  barCloseAtOrBeforeTime,
  horzTimeToEpochSec,
  visibleRangeToEpochSec,
} from "./vector-compare-sync";

test("barCloseAtOrBeforeTime returns last bar close at or before cursor", () => {
  const bars = [
    { time: 100, close: 10 },
    { time: 200, close: 20 },
    { time: 300, close: 30 },
  ];
  assert.equal(barCloseAtOrBeforeTime(bars, 100), 10);
  assert.equal(barCloseAtOrBeforeTime(bars, 50), null);
  assert.equal(barCloseAtOrBeforeTime(bars, 200), 20);
  assert.equal(barCloseAtOrBeforeTime(bars, 250), 20);
  assert.equal(barCloseAtOrBeforeTime(bars, 900), 30);
});

test("horzTimeToEpochSec accepts numeric unix seconds only", () => {
  assert.equal(horzTimeToEpochSec(1_704_000_000), 1_704_000_000);
  assert.equal(horzTimeToEpochSec("2024-01-02"), null);
});

test("visibleRangeToEpochSec validates numeric from/to", () => {
  assert.deepEqual(visibleRangeToEpochSec({ from: 100, to: 500 }), { fromSec: 100, toSec: 500 });
  assert.equal(visibleRangeToEpochSec({ from: 500, to: 100 }), null);
});
