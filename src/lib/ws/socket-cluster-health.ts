import { getUwCacheRedis } from "@/lib/providers/uw-shared-cache";
import { resolveSpotFromUwStockState } from "@/lib/providers/spot-fallback";
import { INDEX_FEED_STALL_MS } from "@/lib/ws/polygon-socket";
import { UW_SOCKET_STALL_MS } from "@/lib/ws/uw-socket-stall";
import { OPTION_MARK_FRESH_MS } from "@/lib/ws/options-socket";
import type { OptionMark } from "@/lib/ws/options-socket";

const POLYGON_SNAPSHOT_KEY = "spx:pulse:snapshot";
const UW_CLUSTER_LAST_MSG_KEY = "uw:ws:last_msg_at";
/** Matches uw-socket.ts TTL — REST cache refresh re-seeds this when WS delivery is absent. */
const UW_CLUSTER_LAST_MSG_TTL_SEC = 180;
const OPTIONS_LEADER_KEY = "options:ws:leader";
const OPTIONS_MARK_PREFIX = "nw:optmark:";
/** RTH liveness window for cluster heartbeats (matches admin UW channel silence threshold). */
const UW_CLUSTER_LIVE_MS = 120_000;
const POLYGON_CLUSTER_LIVE_MS = 30_000;
/** Ordinary clock skew — a future cluster `updatedAt` must not read as infinitely fresh. */
const CLUSTER_SPOT_FUTURE_TOLERANCE_MS = 5_000;

export type ClusterIndexSpot = { price: number; change_pct: number | null };

type IndexSnapshot = Record<
  string,
  { price?: number; change_pct?: number | null; updatedAt?: number; open_source?: string }
>;

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

/** Cross-replica index spot from the ingest leader's Redis snapshot (spx:pulse:snapshot). */
export async function readClusterIndexSpot(
  root: string,
  maxAgeMs: number,
  now = Date.now()
): Promise<ClusterIndexSpot | null> {
  const sym = root.toUpperCase();
  try {
    const redis = await getUwCacheRedis();
    const raw = redis ? await redis.get(POLYGON_SNAPSHOT_KEY) : null;
    if (raw) {
      const snap = JSON.parse(raw) as IndexSnapshot;
      const entry = snap[sym];
      const price = entry?.price;
      const updatedAt = entry?.updatedAt;
      if (entry && price != null && price > 0 && updatedAt) {
        const ageMs = now - updatedAt;
        if (ageMs >= -CLUSTER_SPOT_FUTURE_TOLERANCE_MS && ageMs < maxAgeMs) {
          const changePct = Number(entry.change_pct);
          return {
            price,
            change_pct: Number.isFinite(changePct) ? changePct : null,
          };
        }
      }
    }
  } catch {
    /* fall through to UW */
  }

  // Polygon indices WS snapshot missing/stale (ingest leader down or Polygon REST 403 storm) —
  // UW stock-state is the honest secondary spot during RTH so GEX/quote/socket-health don't go blank.
  return resolveSpotFromUwStockState(sym, now);
}

/** Redis-backed UW cluster heartbeat — web tier reads this without booting local sockets. */
export async function readUwClusterHealth(
  is_leader: boolean,
  now = Date.now()
): Promise<UwClusterHealth> {
  let clusterAt: number | null = null;
  try {
    const redis = await getUwCacheRedis();
    if (redis) {
      const wsVal = await redis.get(UW_CLUSTER_LAST_MSG_KEY);
      if (wsVal) {
        const at = Number(wsVal);
        if (Number.isFinite(at) && at > 0) clusterAt = at;
      }
      // Ingest WS heartbeat absent (market-worker restart / leader churn) but REST cache
      // refresh is live — socket-health seeds uw:rest:last_ok_at; honor it so web-tier
      // probes don't false-fail when members are still served via cache readers.
      if (clusterAt == null) {
        const { UW_REST_LAST_OK_KEY } = await import("@/lib/ws/halt-cluster-store");
        const restVal = await redis.get(UW_REST_LAST_OK_KEY);
        if (restVal) {
          const at = Number(restVal);
          if (Number.isFinite(at) && at > 0) clusterAt = at;
        }
      }
    }
  } catch {
    /* redis optional */
  }
  return buildUwClusterHealth({ is_leader, cluster_last_message_at: clusterAt, now });
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

  // UW stock-state fallback: when the ingest polygon snapshot is absent, a fresh UW SPX print
  // still proves index spot is live (Polygon REST may be 403 while UW tape is healthy).
  if (updatedAt == null) {
    const uw = await resolveSpotFromUwStockState("I:SPX", now);
    if (uw && uw.price > 0) {
      updatedAt = now;
      detail = `I:SPX price=${uw.price} (UW stock-state fallback)`;
    }
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

/**
 * Seed `spx:pulse:snapshot` from UW stock-state when the polygon indices WS is not writing.
 * Called from uw-cache-refresh so web-tier readers + socket-health see a fresh cluster snapshot.
 */
export async function seedPulseSnapshotFromUwPrices(now = Date.now()): Promise<boolean> {
  const targets = ["I:SPX", "I:SPY"] as const;
  const snap: IndexSnapshot = {};
  let seeded = 0;

  for (const sym of targets) {
    const uw = await resolveSpotFromUwStockState(sym, now);
    if (!uw || !(uw.price > 0)) continue;
    snap[sym] = {
      price: uw.price,
      change_pct: uw.change_pct,
      updatedAt: now,
      open_source: "rest",
    };
    seeded += 1;
  }

  if (!seeded) return false;

  try {
    const redis = await getUwCacheRedis();
    if (!redis) return false;
    await redis.setex(POLYGON_SNAPSHOT_KEY, 30, JSON.stringify(snap));
    return true;
  } catch {
    return false;
  }
}

/**
 * Seed `uw:rest:last_ok_at` when UW REST cache refresh succeeds but the ingest WS heartbeat is
 * absent. Used for ops liveness only — MUST NOT write `uw:ws:last_msg_at` (WS delivery key).
 */
export async function seedUwClusterHeartbeat(now = Date.now()): Promise<boolean> {
  const { seedUwRestLiveness } = await import("@/lib/ws/halt-cluster-store");
  return seedUwRestLiveness(now);
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

export type OptionsClusterHealth = {
  leader_present: boolean;
  newest_mark_age_ms: number | null;
  cluster_live: boolean;
  detail: string;
};

/** Web-tier probe: ingest worker owns the options WS; followers check Redis marks / leader lock. */
export async function readOptionsClusterHealth(now = Date.now()): Promise<OptionsClusterHealth> {
  let leader_present = false;
  let newest_mark_age_ms: number | null = null;
  let detail = "no cluster marks";

  try {
    const redis = await getUwCacheRedis();
    if (!redis) {
      return { leader_present: false, newest_mark_age_ms: null, cluster_live: false, detail: "redis unavailable" };
    }

    try {
      const leader = await redis.get(OPTIONS_LEADER_KEY);
      leader_present = Boolean(leader);
    } catch {
      return { leader_present: false, newest_mark_age_ms: null, cluster_live: false, detail: "leader lock read failed" };
    }

    // SCAN is best-effort — some Redis client wrappers only expose get/setex.
    try {
      const scan = (redis as { scan?: (cursor: number, ...args: string[]) => Promise<[string, string[]]> })
        .scan;
      if (typeof scan === "function") {
        const [, keys] = await scan(0, "MATCH", `${OPTIONS_MARK_PREFIX}*`, "COUNT", "20");
        for (const key of keys ?? []) {
          const raw = await redis.get(key);
          if (!raw) continue;
          try {
            const mark = JSON.parse(raw) as OptionMark;
            if (typeof mark.ts === "number" && mark.ts > 0) {
              const age = Math.max(0, now - mark.ts);
              if (newest_mark_age_ms == null || age < newest_mark_age_ms) {
                newest_mark_age_ms = age;
              }
            }
          } catch {
            /* skip malformed */
          }
        }
      }
    } catch {
      /* mark scan optional — leader lock is the primary web-tier signal */
    }

    const marks_fresh = newest_mark_age_ms != null && newest_mark_age_ms <= OPTION_MARK_FRESH_MS;
    if (marks_fresh) {
      detail = `cluster marks fresh (age ${newest_mark_age_ms}ms)`;
    } else if (leader_present) {
      detail = "ingest leader lock held — marks warming";
    } else {
      detail = "no fresh cluster option marks and no ingest leader";
    }

    // Web tier: a held ingest leader means the market-worker owns the live options WS.
    const cluster_live = marks_fresh || leader_present;
    return { leader_present, newest_mark_age_ms, cluster_live, detail };
  } catch {
    return { leader_present, newest_mark_age_ms, cluster_live: false, detail: "cluster read failed" };
  }
}

export function evaluateOptionsClusterOk(
  cluster: OptionsClusterHealth,
  market_hours: boolean,
  local_authenticated: boolean
): { ok: boolean; detail: string } {
  if (!market_hours) {
    return { ok: true, detail: "off-hours — options auth not required" };
  }
  if (local_authenticated) {
    return { ok: true, detail: "local options shard authenticated" };
  }
  if (cluster.cluster_live) {
    return { ok: true, detail: cluster.detail };
  }
  return { ok: false, detail: cluster.detail };
}

export { UW_CLUSTER_LIVE_MS, POLYGON_CLUSTER_LIVE_MS, INDEX_FEED_STALL_MS, UW_SOCKET_STALL_MS };
