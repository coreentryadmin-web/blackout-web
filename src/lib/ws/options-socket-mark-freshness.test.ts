import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getLiveOptionMarkSync,
  optionMarks,
  type OptionMark,
} from "./options-socket";
import { ZERODTE_MARK_FUTURE_TOLERANCE_MS } from "@/lib/zerodte/marks-math";

const OCC = "O:TEST260904C00100000";

test("getLiveOptionMarkSync: future-dated mark is rejected as stale", () => {
  const now = Date.now();
  const futureTs = now + ZERODTE_MARK_FUTURE_TOLERANCE_MS + 5_000;
  optionMarks.set(OCC, { mark: 1.25, bid: 1.2, ask: 1.3, last: null, ts: futureTs } satisfies OptionMark);
  try {
    assert.equal(getLiveOptionMarkSync(OCC, 60_000), null);
  } finally {
    optionMarks.delete(OCC);
  }
});

test("getLiveOptionMarkSync: recent mark within tolerance is returned", () => {
  const now = Date.now();
  const recentTs = now - 5_000;
  optionMarks.set(OCC, { mark: 2.5, bid: 2.4, ask: 2.6, last: null, ts: recentTs } satisfies OptionMark);
  try {
    const hit = getLiveOptionMarkSync(OCC, 60_000);
    assert.ok(hit);
    assert.equal(hit!.mark, 2.5);
    assert.equal(hit!.ts, recentTs);
  } finally {
    optionMarks.delete(OCC);
  }
});
