import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldShowXIntelFixtures } from "./queue-fixtures-gate.ts";
import type { XIntelQueueRow } from "./queue-types.ts";

// Regression (found 2026-10-15, DISCOVERY sweep): AdminXIntelQueuePanel showed the hand-written
// FIXTURES (mixed READY/REVIEW/SKIP rows, not live data) labeled "No queue rows yet" whenever the
// CURRENT status filter returned zero matches -- even when the queue had real rows under a
// different status. Filtering to "SKIP" with zero skips this cycle (but real READY rows elsewhere)
// would wrongly claim the queue is empty and show unrelated fixture rows under a filter the admin
// explicitly chose, directly contradicting this panel's own stated design rule: a reviewer must
// never have an absence-of-data state mislabeled as a different kind of absence.

const SOME_ROW = {} as XIntelQueueRow; // content irrelevant -- only array identity/length matters

test("shouldShowXIntelFixtures: true only for a genuinely empty queue under the ALL filter", () => {
  assert.equal(shouldShowXIntelFixtures("ALL", []), true);
});

test("shouldShowXIntelFixtures: false for a non-ALL filter with zero matches, even if the queue has rows elsewhere", () => {
  assert.equal(shouldShowXIntelFixtures("SKIP", []), false);
  assert.equal(shouldShowXIntelFixtures("READY", []), false);
  assert.equal(shouldShowXIntelFixtures("REVIEW", []), false);
});

test("shouldShowXIntelFixtures: false once real rows exist, regardless of filter", () => {
  assert.equal(shouldShowXIntelFixtures("ALL", [SOME_ROW]), false);
  assert.equal(shouldShowXIntelFixtures("SKIP", [SOME_ROW]), false);
});

test("shouldShowXIntelFixtures: false while rows haven't loaded yet (null)", () => {
  assert.equal(shouldShowXIntelFixtures("ALL", null), false);
});
