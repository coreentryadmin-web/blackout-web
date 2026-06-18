import type { FlowRow } from "@/lib/db";
import { getRedisPubSubStatus, redisPublish, redisSubscribe } from "@/lib/redis-pubsub";

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
      try {
        const flow = JSON.parse(message) as FlowRow;
        if (flow?.ticker) {
          receivedViaRedis += 1;
          fanOutLocal(flow);
        }
      } catch {
        /* ignore */
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
  fanOutLocal(flow);
  void (async () => {
    const ok = await redisPublish(FLOW_REDIS_CHANNEL, JSON.stringify(flow));
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
