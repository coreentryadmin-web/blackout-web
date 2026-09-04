import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isHeartbeatAtFresh } from "./flow-liveness";

describe("isHeartbeatAtFresh", () => {
  const now = Date.parse("2026-09-04T12:00:00.000Z");
  const maxAgeMs = 120_000;

  test("returns true inside the freshness window", () => {
    assert.equal(isHeartbeatAtFresh(now - 60_000, now, maxAgeMs), true);
  });

  test("returns false outside the freshness window", () => {
    assert.equal(isHeartbeatAtFresh(now - maxAgeMs - 1, now, maxAgeMs), false);
  });

  test("returns false for a future-dated heartbeat (clock skew)", () => {
    assert.equal(isHeartbeatAtFresh(now + 30_000, now, maxAgeMs), false);
  });

  test("returns true at exactly maxAgeMs", () => {
    assert.equal(isHeartbeatAtFresh(now - maxAgeMs, now, maxAgeMs), true);
  });
});
