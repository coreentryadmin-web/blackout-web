import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { flowHeartbeatAgeMs } from "./flow-liveness";

describe("flowHeartbeatAgeMs", () => {
  it("ages a normal past heartbeat", () => {
    const now = 1_000_000_000;
    assert.equal(flowHeartbeatAgeMs(now - 5_000, now), 5_000);
    assert.equal(flowHeartbeatAgeMs(now - 180_000, now), 180_000);
  });

  it("clamps future-skewed at to 0 (never negative age / false-fresh)", () => {
    const now = 1_000_000_000;
    assert.equal(flowHeartbeatAgeMs(now + 2_000, now), 0);
    assert.equal(flowHeartbeatAgeMs(now + 1, now), 0);
  });
});
