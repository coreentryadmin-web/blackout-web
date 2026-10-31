import { randomUUID } from "node:crypto";
import type { FlowRow } from "@/lib/db";
import { getRedisPubSubStatus, redisPublish, redisSubscribe } from "@/lib/redis-pubsub";
import { decodeFlowMessage, encodeFlowMessage } from "@/lib/flow-message";

// Per-process identity used to drop our own Redis loopback (see flow-message.ts).
const INSTANCE_ID = randomUUID();

type Listener = (flow: FlowRow) => void;

const listeners = new Set<Listener>();
const FLOW_REDIS_CHANNEL = "blackout:flow-events";

let bridgeReady = false;
let bridgeInit: Promise<void> | null = null;
let redisUnsubscribe: (() => void) | null = null;
let publishedViaRedis = 0;
let receivedViaRedis = 0;

function fanOutLocal(flow: FlowRow): void {
  listeners.forEach((listener) => {
    try {
      listener(flow);
    } catch {
      /* ignore */
    }
  });
}

// Skips our OWN looped-back messages (already fanned locally) and strips the origin tag;
// only genuine cross-instance flows are fanned + counted here.
//
// Hoisted to a single stable function reference (rather than a fresh arrow function built
// inside ensureRedisBridge()) on purpose: redisSubscribe() registers whatever handler it is
// given into redis-pubsub.ts's module-level channelHandlers Set REGARDLESS of whether the
// connection attempt itself succeeds (subscribed:false still adds the handler, so a later,
// unrelated successful subscribe on the same channel can still deliver to it). ensureRedisBridge
// resets bridgeInit to null on every failed attempt specifically so the NEXT caller retries —
// and every caller that connects to this module (init-data-sockets.ts at boot, every new
// /api/market/flows/stream SSE connection) calls initFlowEventBridge()/subscribeFlowEvents()
// again. With a fresh closure built per attempt, each failed retry during a Redis outage leaked
// one more handler into that Set forever (never unsubscribed); once the channel finally
// subscribed, EVERY leaked handler fired on every real message, multiplying one cross-instance
// flow event into N local deliveries to every connected SSE client. A single stable reference
// makes repeated registration idempotent (Set.add() of the same function is a no-op), so retries
// never accumulate duplicates.
function handleRedisFlowMessage(message: string): void {
  const flow = decodeFlowMessage(message, INSTANCE_ID);
  if (flow) {
    receivedViaRedis += 1;
    fanOutLocal(flow);
  }
}

async function ensureRedisBridge(): Promise<void> {
  if (bridgeReady) return;
  if (bridgeInit) return bridgeInit;

  bridgeInit = (async () => {
    const { unsubscribe, subscribed } = await redisSubscribe(
      FLOW_REDIS_CHANNEL,
      handleRedisFlowMessage
    );
    redisUnsubscribe = unsubscribe;
    bridgeReady = subscribed;
    if (!subscribed) {
      bridgeInit = null;
    }
  })();

  return bridgeInit;
}

export function subscribeFlowEvents(listener: Listener): () => void {
  void ensureRedisBridge();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishFlowEvent(flow: FlowRow): void {
  // Unconditional local fan-out guarantees no dropped flow in single-instance /
  // Redis-down states (there is no loopback to rely on there). The self-skip in
  // decodeFlowMessage prevents the loopback from double-fanning on this instance.
  fanOutLocal(flow);
  void (async () => {
    const ok = await redisPublish(FLOW_REDIS_CHANNEL, encodeFlowMessage(INSTANCE_ID, flow));
    if (ok) publishedViaRedis += 1;
  })();
}

export async function initFlowEventBridge(): Promise<void> {
  await ensureRedisBridge();
}

export function getFlowEventsBridgeStatus() {
  const redis = getRedisPubSubStatus();
  return {
    local_listeners: listeners.size,
    redis_bridge_ready: bridgeReady,
    redis_configured: redis.configured,
    redis_publisher_ready: redis.publisher_ready,
    redis_subscriber_ready: redis.subscriber_ready,
    published_via_redis: publishedViaRedis,
    received_via_redis: receivedViaRedis,
    channel: FLOW_REDIS_CHANNEL,
  };
}
