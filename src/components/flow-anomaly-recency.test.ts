import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { FLOW_ANOMALY_RECENCY_MS, isFlowAnomalyRecent } from "./flow-anomaly-recency";

describe("isFlowAnomalyRecent", () => {
  const now = Date.parse("2026-09-04T12:00:00.000Z");

  test("returns true inside the recency window", () => {
    const detectedAt = new Date(now - 5 * 60_000).toISOString();
    assert.equal(isFlowAnomalyRecent(detectedAt, now), true);
  });

  test("returns false outside the recency window", () => {
    const detectedAt = new Date(now - FLOW_ANOMALY_RECENCY_MS - 1).toISOString();
    assert.equal(isFlowAnomalyRecent(detectedAt, now), false);
  });

  test("returns false for a future-dated detection (clock skew)", () => {
    const detectedAt = new Date(now + 30_000).toISOString();
    assert.equal(isFlowAnomalyRecent(detectedAt, now), false);
  });

  test("returns false for unparseable timestamps", () => {
    assert.equal(isFlowAnomalyRecent("not-a-date", now), false);
  });
});
