import { test } from "node:test";
import assert from "node:assert/strict";
import { sharedCacheDel, sharedCacheSet } from "@/lib/shared-cache";
import {
  isFlowFrameFreshAnywhere,
  isFlowFrameFreshFromCluster,
  markFlowFrameDelivered,
  peekFlowLivenessHeartbeat,
} from "./flow-liveness";

const HEARTBEAT_KEY = "flow_alerts:last_delivered_at";

test("isFlowFrameFreshAnywhere: future-dated heartbeat is not fresh", async () => {
  const futureAt = Date.now() + 60_000;
  await sharedCacheSet(HEARTBEAT_KEY, { at: futureAt, instance: "other-replica" }, 90);
  try {
    assert.equal(await isFlowFrameFreshAnywhere(120_000), false);
    const peek = await peekFlowLivenessHeartbeat(120_000);
    assert.equal(peek.heartbeat_present, true);
    assert.equal(peek.fresh, false);
    assert.equal(peek.age_sec, 0);
  } finally {
    await sharedCacheDel(HEARTBEAT_KEY);
  }
});

test("isFlowFrameFreshAnywhere: recent past heartbeat is fresh", async () => {
  const recentAt = Date.now() - 5_000;
  await sharedCacheSet(HEARTBEAT_KEY, { at: recentAt, instance: "other-replica" }, 90);
  try {
    assert.equal(await isFlowFrameFreshAnywhere(120_000), true);
    const peek = await peekFlowLivenessHeartbeat(120_000);
    assert.equal(peek.fresh, true);
    assert.ok((peek.age_sec ?? 0) >= 4);
  } finally {
    await sharedCacheDel(HEARTBEAT_KEY);
  }
});

test("isFlowFrameFreshFromCluster: self-written heartbeat never counts as fresh elsewhere", async () => {
  markFlowFrameDelivered(Date.now());
  assert.equal(await isFlowFrameFreshFromCluster(120_000), false);
});
