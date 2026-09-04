import { test } from "node:test";
import assert from "node:assert/strict";
import { isLuldHaltFeedStale, luldHaltsStore } from "./luld-halts-store";

test("isLuldHaltFeedStale: disabled feed is always stale", () => {
  assert.equal(isLuldHaltFeedStale(60_000, false), true);
});

test("isLuldHaltFeedStale: rejects clock-skewed future last_message_at", () => {
  const now = Date.now();
  luldHaltsStore.last_message_at = now + 60_000;
  assert.equal(isLuldHaltFeedStale(120_000, true), true);
  luldHaltsStore.last_message_at = 0;
});

test("isLuldHaltFeedStale: fresh within maxAgeMs", () => {
  luldHaltsStore.last_message_at = Date.now() - 30_000;
  assert.equal(isLuldHaltFeedStale(120_000, true), false);
  luldHaltsStore.last_message_at = 0;
});
