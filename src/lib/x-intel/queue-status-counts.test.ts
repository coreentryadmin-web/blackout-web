import assert from "node:assert/strict";
import { test } from "node:test";
import { computeXIntelStatusCounts } from "./queue-status-counts.ts";
import { X_INTEL_QUEUE_FIXTURES } from "./queue-fixtures.ts";
import type { XIntelQueueRow } from "./queue-types.ts";

// Regression (DISCOVERY sweep, 2026-10-26): AdminXIntelQueuePanel's status chip bar
// ("ready N · review N · skip N") was computed from the raw API `rows`, while the cards rendered
// below it used `display` (the fixture substitution when `rows` is genuinely empty, per
// `shouldShowXIntelFixtures`). Whenever the real queue was empty, the chip bar read all zeros
// while the fixture cards underneath carried real READY/REVIEW/SKIP badges -- a direct,
// user-visible contradiction. The fix counts over `display`, the same array that is rendered.

function withStatus(status: XIntelQueueRow["status"]): XIntelQueueRow {
  return { status } as XIntelQueueRow;
}

test("computeXIntelStatusCounts: matches the fixture mix when the queue is empty and fixtures are shown", () => {
  const counts = computeXIntelStatusCounts(X_INTEL_QUEUE_FIXTURES);
  const expectedReady = X_INTEL_QUEUE_FIXTURES.filter((r) => r.status === "READY").length;
  const expectedReview = X_INTEL_QUEUE_FIXTURES.filter((r) => r.status === "REVIEW").length;
  const expectedSkip = X_INTEL_QUEUE_FIXTURES.filter((r) => r.status === "SKIP").length;

  // The fixture set must carry a real, non-trivial status mix, or this test would pass vacuously.
  assert.ok(expectedReady > 0 && expectedReview > 0 && expectedSkip > 0);

  assert.deepEqual(counts, { READY: expectedReady, REVIEW: expectedReview, SKIP: expectedSkip });
});

test("computeXIntelStatusCounts: never reports all-zero while the displayed array has rows", () => {
  const display = [withStatus("READY"), withStatus("REVIEW"), withStatus("SKIP")];
  const counts = computeXIntelStatusCounts(display);
  assert.deepEqual(counts, { READY: 1, REVIEW: 1, SKIP: 1 });
});

test("computeXIntelStatusCounts: genuinely zero for a genuinely empty displayed array", () => {
  assert.deepEqual(computeXIntelStatusCounts([]), { READY: 0, REVIEW: 0, SKIP: 0 });
});
