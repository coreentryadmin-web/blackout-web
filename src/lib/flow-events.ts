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

async function ensureRedisBridge(): Promise<void> {
  if (bridgeReady) return;
  if (bridgeInit) return bridgeInit;

  bridgeInit = (async () => {
    redisUnsubscribe = await redisSubscribe(FLOW_REDIS_CHANNEL, (message) => {
      // Skips our OWN looped-back messages (already fanned locally) and strips the
      // origin tag; only genuine cross-instance flows are fanned + counted here.
      const flow = decodeFlowMessage(message, INSTANCE_ID);
      if (flow) {
        receivedViaRedis += 1;
        fanOutLocal(flow);
      }
    });
    bridgeReady = true;
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
