import { test } from "node:test";
import assert from "node:assert/strict";
import {
  vectorComparePerfPollMs,
  vectorWallsScopePollMs,
  VECTOR_COMPARE_FOUR_UP_POLL_MULTIPLIER,
} from "./vector-cadence";

test("vectorWallsScopePollMs: oracle + shared universe 5s, on-demand 15s", () => {
  assert.equal(vectorWallsScopePollMs("SPX"), 5_000);
  assert.equal(vectorWallsScopePollMs("META"), 5_000);
  assert.equal(vectorWallsScopePollMs("NVDA"), 5_000);
  assert.equal(vectorWallsScopePollMs("ZZZZ"), 15_000);
});

test("vectorComparePerfPollMs: doubles cadence for 4-up background panes", () => {
  assert.equal(vectorComparePerfPollMs(5_000, false), 5_000);
  assert.equal(vectorComparePerfPollMs(5_000, true), 5_000 * VECTOR_COMPARE_FOUR_UP_POLL_MULTIPLIER);
});
