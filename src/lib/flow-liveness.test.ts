import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { flowHeartbeatAgeMs } from "./flow-liveness";

describe("flowHeartbeatAgeMs", () => {
  const now = 1_700_000_000_000;

  test("returns age for a normal past timestamp", () => {
    assert.equal(flowHeartbeatAgeMs(now - 30_000, now), 30_000);
  });

  test("returns null for a far-future timestamp (would falsely read fresh)", () => {
    assert.equal(flowHeartbeatAgeMs(now + 5 * 60_000, now), null);
  });

  test("allows small clock skew within tolerance", () => {
    assert.equal(flowHeartbeatAgeMs(now + 30_000, now), -30_000);
  });
});
