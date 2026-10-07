// Behavioral tests for selectDarkPoolWarmBatch/halfBatchSize — see rotation.ts's header comment
// for the live-production root cause this rotation addresses (2026-10-07 re-measurement: the
// full-universe fan-out still fails 90%+ of tickers per run even after the shared UW rate
// limiter's cluster-wide ceiling was separately doubled, PR #5579).

import { test } from "node:test";
import assert from "node:assert/strict";
import { halfBatchSize, selectDarkPoolWarmBatch } from "./rotation";

test("halfBatchSize rounds up so an odd-length universe is never under-covered", () => {
  assert.equal(halfBatchSize(68), 34);
  assert.equal(halfBatchSize(69), 35);
  assert.equal(halfBatchSize(1), 1);
  assert.equal(halfBatchSize(0), 0);
});

test("selectDarkPoolWarmBatch picks exactly half the universe starting at the cursor", () => {
  const tickers = Array.from({ length: 10 }, (_, i) => `T${i}`);
  const { batch, nextCursor } = selectDarkPoolWarmBatch(tickers, 0, halfBatchSize(tickers.length));
  assert.deepEqual(batch, ["T0", "T1", "T2", "T3", "T4"]);
  assert.equal(nextCursor, 5);
});

test("selectDarkPoolWarmBatch wraps around the end of the list", () => {
  const tickers = Array.from({ length: 10 }, (_, i) => `T${i}`);
  const { batch, nextCursor } = selectDarkPoolWarmBatch(tickers, 8, halfBatchSize(tickers.length));
  // Starting at index 8 with batch size 5: T8, T9, T0, T1, T2 (wraps).
  assert.deepEqual(batch, ["T8", "T9", "T0", "T1", "T2"]);
  assert.equal(nextCursor, 3);
});

test("two consecutive runs starting from the persisted cursor cover the FULL universe exactly once each", () => {
  const tickers = Array.from({ length: 69 }, (_, i) => `T${i}`);
  const batchSize = halfBatchSize(tickers.length);

  const run1 = selectDarkPoolWarmBatch(tickers, 0, batchSize);
  const run2 = selectDarkPoolWarmBatch(tickers, run1.nextCursor, batchSize);

  const covered = new Set([...run1.batch, ...run2.batch]);
  assert.equal(covered.size, tickers.length, "every ticker must be covered across the 2-run rotation");
  for (const t of tickers) assert.ok(covered.has(t), `missing ${t}`);
});

test("an out-of-range or negative cursor (e.g. universe shrank between deploys) is normalized, never throws", () => {
  const tickers = Array.from({ length: 10 }, (_, i) => `T${i}`);
  assert.doesNotThrow(() => selectDarkPoolWarmBatch(tickers, -3, 5));
  assert.doesNotThrow(() => selectDarkPoolWarmBatch(tickers, 1000, 5));
  const { batch } = selectDarkPoolWarmBatch(tickers, 1000, 5);
  assert.equal(batch.length, 5);
});

test("an empty universe returns an empty batch and a zero cursor rather than throwing", () => {
  const { batch, nextCursor } = selectDarkPoolWarmBatch([], 0, 10);
  assert.deepEqual(batch, []);
  assert.equal(nextCursor, 0);
});

test("batchSize >= universe length returns the whole universe unrotated and resets the cursor to 0", () => {
  const tickers = Array.from({ length: 5 }, (_, i) => `T${i}`);
  const { batch, nextCursor } = selectDarkPoolWarmBatch(tickers, 3, 5);
  assert.deepEqual(batch, tickers);
  assert.equal(nextCursor, 0);

  const { batch: batch2, nextCursor: cursor2 } = selectDarkPoolWarmBatch(tickers, 2, 99);
  assert.deepEqual(batch2, tickers);
  assert.equal(cursor2, 0);
});

test("a non-positive batchSize safely falls back to the whole universe rather than an infinite loop", () => {
  const tickers = Array.from({ length: 5 }, (_, i) => `T${i}`);
  const { batch, nextCursor } = selectDarkPoolWarmBatch(tickers, 0, 0);
  assert.deepEqual(batch, tickers);
  assert.equal(nextCursor, 0);
});
