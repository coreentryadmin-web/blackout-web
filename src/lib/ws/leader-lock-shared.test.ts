import assert from "node:assert/strict";
import { describe, test } from "node:test";

// Regression: all four WS leader-lock managers (uw-socket, polygon-socket, options-socket,
// stocks-socket) used to fail OPEN unconditionally when Redis was unavailable ("single-replica
// safe" comments that were only true at REPLICA_COUNT<=1). On the real multi-replica production
// topology a Redis outage would make every replica think it's the leader simultaneously,
// contending for a single upstream WS slot. wsLeaderShouldFailOpenWithoutRedis() gates that
// fail-open on REPLICA_COUNT so a multi-replica deploy fails CLOSED instead.

describe("ws/leader-lock-shared: wsLeaderShouldFailOpenWithoutRedis", () => {
  test("fails open at the default REPLICA_COUNT=1", async () => {
    delete process.env.REPLICA_COUNT;
    const { wsLeaderShouldFailOpenWithoutRedis } = await import("./leader-lock-shared");
    assert.equal(wsLeaderShouldFailOpenWithoutRedis(), true);
  });

  test("fails closed for any multi-replica count", async () => {
    const { wsLeaderShouldFailOpenWithoutRedis } = await import("./leader-lock-shared");
    assert.equal(wsLeaderShouldFailOpenWithoutRedis(2), false);
    assert.equal(wsLeaderShouldFailOpenWithoutRedis(5), false);
  });

  test("fails open only at replicaCount<=1", async () => {
    const { wsLeaderShouldFailOpenWithoutRedis } = await import("./leader-lock-shared");
    assert.equal(wsLeaderShouldFailOpenWithoutRedis(1), true);
    assert.equal(wsLeaderShouldFailOpenWithoutRedis(0), true);
  });
});

describe("ws/leader-lock-shared: alertWsLeaderFailClosedOnce / clearWsLeaderFailClosedAlert", () => {
  test("does not throw when notifyOpsDiscord's dynamic import resolves or rejects", async () => {
    const { alertWsLeaderFailClosedOnce, clearWsLeaderFailClosedAlert } = await import(
      "./leader-lock-shared"
    );
    assert.doesNotThrow(() => alertWsLeaderFailClosedOnce("test-socket"));
    assert.doesNotThrow(() => alertWsLeaderFailClosedOnce("test-socket")); // second call is a no-op (already latched)
    assert.doesNotThrow(() => clearWsLeaderFailClosedAlert("test-socket"));
  });
});
