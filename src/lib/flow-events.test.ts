import { before, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { FlowRow } from "@/lib/db";

// mock.module() must be registered before flow-events.ts (and therefore its dependency
// imports: redis-pubsub, flow-message) is ever loaded — same ordering requirement as
// admin-gex-health.test.ts's own header comment documents. The module under test is loaded
// dynamically inside before(). Always the RELATIVE path, never the @/ alias (Node 20 gotcha).

// A hand-rolled stand-in for the REAL redis-pubsub.ts's channelHandlers Set: every call to
// redisSubscribe() for the channel ADDS its handler to this Set, exactly like the real module
// does (regardless of whether the connection attempt itself succeeds) — so this fixture
// reproduces the exact accumulation shape the real module has, without needing a live Redis.
const registeredHandlers = new Set<(message: string) => void>();
let subscribeCallCount = 0;
/** First two calls report a failed connection attempt (subscribed:false); the third succeeds —
 *  simulating a Redis outage that clears up after two retries. */
const SUCCEED_ON_CALL = 3;

function deliverRedisMessage(message: string): void {
  for (const handler of registeredHandlers) handler(message);
}

mock.module("./redis-pubsub", {
  namedExports: {
    redisPublish: async () => true,
    redisSubscribe: async (_channel: string, handler: (message: string) => void) => {
      subscribeCallCount += 1;
      registeredHandlers.add(handler);
      const subscribed = subscribeCallCount >= SUCCEED_ON_CALL;
      return {
        subscribed,
        unsubscribe: () => registeredHandlers.delete(handler),
      };
    },
    getRedisPubSubStatus: () => ({
      configured: true,
      publisher_ready: true,
      subscriber_ready: true,
      subscribed_channels: [],
    }),
  },
});

let initFlowEventBridge: typeof import("./flow-events").initFlowEventBridge;
let subscribeFlowEvents: typeof import("./flow-events").subscribeFlowEvents;
let getFlowEventsBridgeStatus: typeof import("./flow-events").getFlowEventsBridgeStatus;

before(async () => {
  ({ initFlowEventBridge, subscribeFlowEvents, getFlowEventsBridgeStatus } = await import(
    "./flow-events"
  ));
});

function fakeFlow(ticker: string): FlowRow {
  return {
    ticker,
    premium: 100_000,
    option_type: "call",
    expiry: "2026-12-18",
    strike: 100,
    direction: "bullish",
    score: 50,
    route: "sweep",
    alerted_at: "2026-10-31T14:00:00.000Z",
  };
}

test("flow-events: a retried subscribe after transient failures registers ONE handler, not one per attempt", async () => {
  // Simulate initFlowEventBridge() being called repeatedly while the bridge keeps failing to
  // establish (ensureRedisBridge resets bridgeInit to null on every subscribed:false result, so
  // the NEXT caller — e.g. the next SSE client's initFlowEventBridge()/subscribeFlowEvents() —
  // retries from scratch). This mirrors init-data-sockets.ts calling initFlowEventBridge() and
  // every new /api/market/flows/stream SSE connection calling it again.
  await initFlowEventBridge(); // attempt 1 — fails
  await initFlowEventBridge(); // attempt 2 — fails
  await initFlowEventBridge(); // attempt 3 — succeeds

  assert.equal(subscribeCallCount, 3, "expected exactly 3 redisSubscribe attempts in this fixture");
  assert.equal(
    getFlowEventsBridgeStatus().redis_bridge_ready,
    true,
    "bridge should report ready after the 3rd (successful) attempt"
  );

  // The real bug: each failed attempt builds a brand-new closure and never unsubscribes it, so
  // the module-level channelHandlers Set accumulates one leaked handler per failed retry. Once
  // the channel is actually subscribed, EVERY leaked handler fires on every Redis message —
  // amplifying a single cross-instance flow event into N local deliveries.
  let localDeliveries = 0;
  const unsubscribeLocal = subscribeFlowEvents(() => {
    localDeliveries += 1;
  });

  try {
    // One real Redis PUBLISH, from a DIFFERENT instance (no __origin match), delivered once.
    deliverRedisMessage(JSON.stringify({ ...fakeFlow("AAPL"), __origin: "some-other-replica" }));

    assert.equal(
      localDeliveries,
      1,
      `a single cross-instance flow message must fan out to each local listener exactly once ` +
        `— got ${localDeliveries}, implying ${registeredHandlers.size} leaked duplicate handler(s) ` +
        `registered across the 3 retry attempts instead of 1`
    );
    assert.equal(
      getFlowEventsBridgeStatus().received_via_redis,
      1,
      "received_via_redis should count the message exactly once, not once per leaked handler"
    );
  } finally {
    unsubscribeLocal();
  }
});
