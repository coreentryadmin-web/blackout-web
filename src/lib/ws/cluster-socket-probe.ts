/**
 * Cluster-wide socket health for web-tier replicas that do not hold local WS state.
 * Reads Redis leader locks + UW delivery heartbeat written by the ingest worker.
 */

import { uwConfigured } from "@/lib/providers/config";

const LEADER_KEYS = {
  unusual_whales: "uw:ws:leader",
  polygon_indices: "polygon:indices:leader",
  options: "options:ws:leader",
  stocks_luld: "stocks:ws:leader",
} as const;

const UW_CLUSTER_LAST_MSG_KEY = "uw:ws:last_msg_at";
const LEADER_STALE_MS = 60_000;
const UW_MSG_STALE_MS = 120_000;

type RedisProbe = {
  get(key: string): Promise<string | null>;
  ttl(key: string): Promise<number>;
  disconnect(): void;
};

async function redisProbe(): Promise<RedisProbe | null> {
  if (!process.env.REDIS_URL?.trim()) return null;
  try {
    const { default: Redis } = await import("ioredis");
    const client = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3_000,
      lazyConnect: true,
    });
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

export type ClusterSocketProbe = {
  ok: boolean;
  mode: "cluster_redis" | "unconfigured";
  as_of: string;
  leaders: Record<string, { held: boolean; ttl_sec: number | null }>;
  uw_last_msg_age_ms: number | null;
  detail?: string;
};

export async function probeClusterSocketHealth(): Promise<ClusterSocketProbe> {
  const as_of = new Date().toISOString();
  const redis = await redisProbe();

  if (!redis) {
    return {
      ok: !uwConfigured(),
      mode: "unconfigured",
      as_of,
      leaders: {},
      uw_last_msg_age_ms: null,
      detail: uwConfigured() ? "Redis unavailable — cannot verify ingest worker" : "UW not configured",
    };
  }

  try {
    const leaders: ClusterSocketProbe["leaders"] = {};
    let anyLeader = false;

    for (const [name, key] of Object.entries(LEADER_KEYS)) {
      const [val, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);
      const held = Boolean(val?.trim()) && ttl > 0;
      if (held) anyLeader = true;
      leaders[name] = { held, ttl_sec: ttl > 0 ? ttl : null };
    }

    const lastMsgRaw = await redis.get(UW_CLUSTER_LAST_MSG_KEY);
    const lastMsgAt = lastMsgRaw ? Number(lastMsgRaw) : null;
    const uw_last_msg_age_ms =
      lastMsgAt != null && Number.isFinite(lastMsgAt) ? Date.now() - lastMsgAt : null;

    const uwFresh =
      !uwConfigured() ||
      (uw_last_msg_age_ms != null && uw_last_msg_age_ms <= UW_MSG_STALE_MS);

    const leadersFresh = !uwConfigured() || anyLeader;

    const ok = leadersFresh && uwFresh;

    return {
      ok,
      mode: "cluster_redis",
      as_of,
      leaders,
      uw_last_msg_age_ms,
      ...(!ok
        ? {
            detail: !leadersFresh
              ? "No WS leader locks in Redis — ingest worker may be down"
              : "UW cluster heartbeat stale",
          }
        : {}),
    };
  } finally {
    try {
      redis.disconnect();
    } catch {
      /* ignore */
    }
  }
}
