import { test } from "node:test";
import assert from "node:assert/strict";
import {
  flowTimestampAgeMs,
  markFlowDataFresh,
  newestFlowAgeMsFromBriefs,
  resolveFlowDataAgeMs,
} from "./flow-data-freshness";

test("newestFlowAgeMsFromBriefs uses the newest alerted_at row", () => {
  const now = Date.parse("2026-06-29T16:00:00.000Z");
  const age = newestFlowAgeMsFromBriefs(
    [
      { alerted_at: "2026-06-29T15:30:00.000Z" },
      { alerted_at: "2026-06-29T15:58:00.000Z" },
    ],
    now
  );
  assert.equal(age, 2 * 60_000);
});

test("newestFlowAgeMsFromBriefs: far-future alerted_at returns null (not age 0)", () => {
  const now = Date.parse("2026-06-29T16:00:00.000Z");
  const age = newestFlowAgeMsFromBriefs([{ alerted_at: "2026-06-29T16:05:00.000Z" }], now);
  assert.equal(age, null);
});

test("flowTimestampAgeMs: modest clock skew within tolerance reads as age 0", () => {
  const now = 1_700_000_000_000;
  assert.equal(flowTimestampAgeMs(now + 2_000, now), 0);
});

test("resolveFlowDataAgeMs prefers fresh tape over stale in-memory stamp", () => {
  markFlowDataFresh(Date.parse("2026-06-29T14:00:00.000Z"));
  const now = Date.parse("2026-06-29T16:00:00.000Z");
  const age = resolveFlowDataAgeMs([{ alerted_at: "2026-06-29T15:58:00.000Z" }], now);
  assert.equal(age, 2 * 60_000);
});
