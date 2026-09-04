import { test } from "node:test";
import assert from "node:assert/strict";
import {
  _setUwChannelLastMessageForTest,
  getUwSocketHealth,
  isUwChannelFresh,
} from "./uw-socket";
import { WS_TIMESTAMP_FUTURE_TOLERANCE_MS } from "./timestamp-freshness";

test("isUwChannelFresh: recent delivery is fresh", () => {
  const now = Date.now();
  _setUwChannelLastMessageForTest("flow_alerts", now - 5_000);
  assert.equal(isUwChannelFresh("flow_alerts", 120_000), true);
  _setUwChannelLastMessageForTest("flow_alerts", undefined);
});

test("isUwChannelFresh: clock-skewed future timestamp must not read as fresh", () => {
  const now = Date.now();
  const futureAt = now + WS_TIMESTAMP_FUTURE_TOLERANCE_MS + 5_000;
  _setUwChannelLastMessageForTest("flow_alerts", futureAt);
  assert.equal(
    isUwChannelFresh("flow_alerts", 120_000),
    false,
    "future-skewed channel timestamp must not bypass REST fallback"
  );
  _setUwChannelLastMessageForTest("flow_alerts", undefined);
});

test("isUwChannelFresh: small future skew within tolerance still fresh", () => {
  const now = Date.now();
  _setUwChannelLastMessageForTest("net_flow", now + 2_000);
  assert.equal(isUwChannelFresh("net_flow", 120_000), true);
  _setUwChannelLastMessageForTest("net_flow", undefined);
});

test("getUwSocketHealth: cluster_live false when freshest delivery is far in the future", () => {
  const now = Date.now();
  const futureAt = now + WS_TIMESTAMP_FUTURE_TOLERANCE_MS + 10_000;
  _setUwChannelLastMessageForTest("flow_alerts", futureAt);
  const health = getUwSocketHealth();
  assert.equal(health.cluster_live, false);
  assert.equal(health.last_message_age_ms.flow_alerts, 0);
  _setUwChannelLastMessageForTest("flow_alerts", undefined);
});
