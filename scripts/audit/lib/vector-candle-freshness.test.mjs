import test from "node:test";
import assert from "node:assert/strict";
import {
  isVectorCandleStale,
  maxVectorCandleFreshSec,
} from "./vector-candle-freshness.mjs";

test("maxVectorCandleFreshSec scales with wallTrailSec and probe hold", () => {
  assert.equal(maxVectorCandleFreshSec(5, 8000), 20);
  assert.equal(maxVectorCandleFreshSec(15, 8000), 40);
  assert.equal(maxVectorCandleFreshSec(undefined, 8000), 20);
});

test("isVectorCandleStale accepts borderline 5s-trail ages", () => {
  assert.equal(isVectorCandleStale(9, 5, 8000), false);
  assert.equal(isVectorCandleStale(12, 5, 8000), false);
  assert.equal(isVectorCandleStale(21, 5, 8000), true);
});
