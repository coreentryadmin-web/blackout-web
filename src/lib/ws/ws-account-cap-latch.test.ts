import { test } from "node:test";
import assert from "node:assert/strict";
import {
  POLYGON_ACCOUNT_CAP_PAUSE_MS,
  polygonAccountCapUntilMs,
  remainingAccountCapPauseMs,
} from "./ws-account-cap-latch";

test("polygonAccountCapUntilMs adds pause window", () => {
  const now = 1_000_000;
  assert.equal(polygonAccountCapUntilMs(now, 60_000), 1_060_000);
});

test("remainingAccountCapPauseMs is zero when cap expired", () => {
  assert.equal(remainingAccountCapPauseMs(500, 1_000), 0);
  assert.equal(remainingAccountCapPauseMs(2_000, 1_000), 1_000);
});

test("default pause is five minutes", () => {
  assert.equal(POLYGON_ACCOUNT_CAP_PAUSE_MS, 300_000);
});
