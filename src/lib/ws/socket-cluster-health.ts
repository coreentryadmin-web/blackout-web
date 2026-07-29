import { getUwCacheRedis } from "@/lib/providers/uw-shared-cache";
import { INDEX_FEED_STALL_MS } from "@/lib/ws/polygon-socket";
import { OPTION_MARK_FRESH_MS } from "@/lib/ws/options-socket";
import { UW_SOCKET_STALL_MS } from "@/lib/ws/uw-socket-stall";

const OPTIONS_MARK_REDIS_PREFIX = "nw:optmark:";

const POLYGON_SNAPSHOT_KEY = "spx:pulse:snapshot";
/** RTH liveness window for cluster heartbeats (matches admin UW channel silence threshold). */
const UW_CLUSTER_LIVE_MS = 120_000;
const POLYGON_CLUSTER_LIVE_MS = 30_000;

type IndexSnapshot = Record<string, { price?: number; updatedAt?: number }>;

export type UwClusterHealth = {
  is_leader: boolean;
  cluster_last_message_at: number | null;
  cluster_last_message_age_ms: number | null;
  cluster_live: boolean;
};

export type PolygonClusterHealth = {
  is_leader: boolean;
  cluster_spx_updated_at: number | null;
  cluster_spx_age_ms: number | null;
  cluster_live: boolean;
  detail: string;
};

export type OptionsClusterHealth = {
  fresh_mark_count: number;
  freshest_mark_age_ms: number | null;
  cluster_live: boolean;
  detail: string;
};

export function buildUwClusterHealth(input: {
  is_leader: boolean;
  cluster_last_message_at: number | null;
  now?: number;
}): UwClusterHealth {
  const now = input.now ?? Date.now();
  const at = input.cluster_last_message_at;
  const age = at != null ? Math.max(0, now - at) : null;
  return {
    is_leader: input.is_leader,
    cluster_last_message_at: at,
    cluster_last_message_age_ms: age,
    cluster_live: age != null && age <= UW_CLUSTER_LIVE_MS,
  };
}

export async function readPolygonClusterHealth(
  is_leader: boolean,
  now = Date.now()
): Promise<PolygonClusterHealth> {
  let updatedAt: number | null = null;
  let detail = "no cluster snapshot";

  try {
    const redis = await getUwCacheRedis();
    const raw = redis ? await redis.get(POLYGON_SNAPSHOT_KEY) : null;
    const snap = raw ? (JSON.parse(raw) as IndexSnapshot) : null;
    const spx = snap?.["I:SPX"];
    if (spx && typeof spx.updatedAt === "number" && spx.updatedAt > 0) {
      updatedAt = spx.updatedAt;
      detail = `I:SPX price=${spx.price ?? 0}`;
    }
  } catch {
    detail = "snapshot read failed";
  }

  const age = updatedAt != null ? Math.max(0, now - updatedAt) : null;
  const cluster_live = age != null && age <= POLYGON_CLUSTER_LIVE_MS;

  return {
    is_leader,
    cluster_spx_updated_at: updatedAt,
    cluster_spx_age_ms: age,
    cluster_live,
    detail,
  };
}

/** Cron / ops: cluster-aware OK — followers are healthy when the leader heartbeat is fresh. */
export function evaluateUwClusterOk(
  uw: UwClusterHealth,
  market_hours: boolean
): { ok: boolean; detail: string } {
  if (!market_hours) {
    return { ok: true, detail: "off-hours — cluster heartbeat not required" };
  }
  if (uw.is_leader) {
    if (uw.cluster_live) return { ok: true, detail: "leader — local/cluster delivery fresh" };
    return { ok: false, detail: "leader — no UW delivery within stall window" };
  }
  if (uw.cluster_live) {
    return { ok: true, detail: "follower — cluster leader heartbeat fresh" };
  }
  return { ok: false, detail: "follower — cluster UW heartbeat stale or missing" };
}

/** Cron / ops: sample Redis option marks written by the ingest-tier options WS leader. */
export async function readOptionsClusterHealth(now = Date.now()): Promise<OptionsClusterHealth> {
  let freshMarkCount = 0;
  let freshestAge: number | null = null;
  let detail = "no cluster option marks";

  try {
    const redis = await getUwCacheRedis();
    if (redis) {
      const keys = await (redis as unknown as { keys(pattern: string): Promise<string[]> }).keys(
        `${OPTIONS_MARK_REDIS_PREFIX}*`
      );
      for (const key of keys.slice(0, 32)) {
        const raw = await redis.get(key);
        if (!raw) continue;
        const hit = JSON.parse(raw) as { mark?: number; ts?: number };
        if (hit?.mark == null || typeof hit.ts !== "number" || hit.ts <= 0) continue;
        const age = Math.max(0, now - hit.ts);
        if (age <= OPTION_MARK_FRESH_MS) {
          freshMarkCount += 1;
          if (freshestAge == null || age < freshestAge) freshestAge = age;
        }
      }
    }
  } catch {
    detail = "option mark snapshot read failed";
  }

  if (freshMarkCount > 0) {
    detail = `${freshMarkCount} fresh mark(s), youngest ${freshestAge ?? "?"}ms`;
  }

  return {
    fresh_mark_count: freshMarkCount,
    freshest_mark_age_ms: freshestAge,
    cluster_live: freshMarkCount > 0,
    detail,
  };
}

export function evaluateOptionsClusterOk(
  options: {
    enabled: boolean;
    is_leader: boolean;
    total_contracts: number;
    authenticated_shards: number;
    auth_failed_shards: number;
  },
  cluster: OptionsClusterHealth,
  market_hours: boolean
): { ok: boolean; detail: string } {
  if (!options.enabled) {
    return { ok: true, detail: "disabled — REST snapshot fallback" };
  }
  if (!market_hours) {
    return { ok: true, detail: "off-hours — auth not required" };
  }
  if (options.authenticated_shards > 0) {
    return {
      ok: true,
      detail: `authenticated (${options.authenticated_shards} shard(s), ${options.total_contracts} contracts)`,
    };
  }
  if (options.auth_failed_shards > 0) {
    return {
      ok: false,
      detail: `auth failed on ${options.auth_failed_shards} shard(s) — check POLYGON_API_KEY / options WS entitlement`,
    };
  }
  if (cluster.cluster_live) {
    return { ok: true, detail: `cluster marks fresh — ${cluster.detail}` };
  }
  if (options.total_contracts === 0) {
    return { ok: true, detail: "no held contracts — auth not required" };
  }
  if (options.is_leader) {
    return { ok: false, detail: "leader with held contracts but no authenticated shard yet" };
  }
  return { ok: false, detail: `follower — cluster option marks stale or missing (${cluster.detail})` };
}

export function evaluatePolygonClusterOk(
  polygon: PolygonClusterHealth,
  market_hours: boolean
): { ok: boolean; detail: string } {
  if (!market_hours) {
    return { ok: true, detail: "off-hours — index snapshot not required" };
  }
  if (polygon.is_leader) {
    if (polygon.cluster_live) return { ok: true, detail: "leader — I:SPX snapshot fresh" };
    return { ok: false, detail: "leader — I:SPX snapshot stale" };
  }
  if (polygon.cluster_live) {
    return { ok: true, detail: `follower — ${polygon.detail}` };
  }
  return { ok: false, detail: "follower — cluster I:SPX snapshot stale or missing" };
}

export { UW_CLUSTER_LIVE_MS, POLYGON_CLUSTER_LIVE_MS, INDEX_FEED_STALL_MS, UW_SOCKET_STALL_MS };
