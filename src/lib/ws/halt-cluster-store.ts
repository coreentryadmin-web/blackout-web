/**
 * Cross-replica halt state — ingest writes, web tier reads.
 *
 * tradingHaltsStore / luldHaltsStore are in-process only. Web replicas (PROCESS_ROLE=web)
 * never boot upstream WS, so gate code that reads those stores alone fails OPEN on active
 * halts. This module mirrors active halts + LULD delivery heartbeat to Redis.
 */
import { getUwCacheRedis } from "@/lib/providers/uw-shared-cache";
import type { StoredTradingHalt } from "@/lib/ws/trading-halts-expiry";
import type { TradingHaltEvent } from "@/lib/providers/unusual-whales";

export const HALTS_CLUSTER_UW_KEY = "halts:cluster:uw:v1";
export const HALTS_CLUSTER_LULD_KEY = "halts:cluster:luld:v1";
/** Align with TRADING_HALT_MAX_AGE_MS ceiling — stale entries self-expire. */
export const HALTS_CLUSTER_TTL_SEC = 30 * 60;
export const LULD_CLUSTER_LAST_MSG_KEY = "luld:ws:last_msg_at";
const LULD_CLUSTER_LAST_MSG_TTL_SEC = 180;
/** REST/cache liveness — MUST NOT be confused with uw:ws:last_msg_at (ingest WS delivery). */
export const UW_REST_LAST_OK_KEY = "uw:rest:last_ok_at";
const UW_REST_LAST_OK_TTL_SEC = 180;

/** In-process cache — warmed from Redis on web tier before sync halt reads. */
let clusterUwHalts: StoredTradingHalt[] = [];
let clusterLuldHalts: StoredTradingHalt[] = [];
let clusterLuldLastMsgAt: number | null = null;

function serializeHalts(map: Map<string, StoredTradingHalt>): StoredTradingHalt[] {
  return Array.from(map.values()).filter((h) => h.active);
}

async function writeJson(key: string, value: unknown, ttlSec: number): Promise<void> {
  try {
    const redis = await getUwCacheRedis();
    if (!redis) return;
    await redis.setex(key, ttlSec, JSON.stringify(value));
  } catch {
    /* best-effort */
  }
}

/** Ingest: persist UW active halts after every trading_halts WS event. */
export async function persistClusterUwHalts(
  halts: Map<string, StoredTradingHalt>,
  now = Date.now()
): Promise<void> {
  clusterUwHalts = serializeHalts(halts);
  await writeJson(HALTS_CLUSTER_UW_KEY, { halts: clusterUwHalts, updated_at: now }, HALTS_CLUSTER_TTL_SEC);
}

/** Ingest: persist LULD active halts after every LULD event batch. */
export async function persistClusterLuldHalts(
  halts: Map<string, StoredTradingHalt>,
  now = Date.now()
): Promise<void> {
  clusterLuldHalts = serializeHalts(halts);
  await writeJson(HALTS_CLUSTER_LULD_KEY, { halts: clusterLuldHalts, updated_at: now }, HALTS_CLUSTER_TTL_SEC);
}

/** Ingest: LULD socket delivered — cluster heartbeat for web-tier staleness. */
export async function touchClusterLuldFreshness(at = Date.now()): Promise<void> {
  clusterLuldLastMsgAt = at;
  try {
    const redis = await getUwCacheRedis();
    if (!redis) return;
    await redis.setex(LULD_CLUSTER_LAST_MSG_KEY, LULD_CLUSTER_LAST_MSG_TTL_SEC, String(at));
  } catch {
    /* best-effort */
  }
}

/** REST/cache refresh succeeded — honest ops liveness, NOT WS delivery. */
export async function seedUwRestLiveness(now = Date.now()): Promise<boolean> {
  try {
    const redis = await getUwCacheRedis();
    if (!redis) return false;
    await redis.setex(UW_REST_LAST_OK_KEY, UW_REST_LAST_OK_TTL_SEC, String(now));
    return true;
  } catch {
    return false;
  }
}

function parseHaltsPayload(raw: string | null): StoredTradingHalt[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { halts?: StoredTradingHalt[] };
    return Array.isArray(parsed.halts) ? parsed.halts : [];
  } catch {
    return [];
  }
}

/** Web tier: load cluster halts + LULD heartbeat before sync gate reads. */
export async function warmClusterHaltsFromRedis(): Promise<void> {
  try {
    const redis = await getUwCacheRedis();
    if (!redis) return;
    const [uwRaw, luldRaw, luldAt] = await Promise.all([
      redis.get(HALTS_CLUSTER_UW_KEY),
      redis.get(HALTS_CLUSTER_LULD_KEY),
      redis.get(LULD_CLUSTER_LAST_MSG_KEY),
    ]);
    clusterUwHalts = parseHaltsPayload(uwRaw);
    clusterLuldHalts = parseHaltsPayload(luldRaw);
    if (luldAt) {
      const at = Number(luldAt);
      if (Number.isFinite(at) && at > 0) clusterLuldLastMsgAt = at;
    }
  } catch {
    /* redis optional */
  }
}

export function getClusterLuldLastMessageAt(): number | null {
  return clusterLuldLastMsgAt;
}

function storedToEvent(h: StoredTradingHalt): TradingHaltEvent {
  return {
    symbol: h.symbol,
    halt_type: h.halt_type,
    reason: h.reason,
    halted_at: h.halted_at,
    active: true,
  };
}

/** Merge in-process halts with the cluster cache (web tier reads Redis via warm). */
export function mergeClusterHalts(localUw: TradingHaltEvent[], localLuld: TradingHaltEvent[]): TradingHaltEvent[] {
  const bySym = new Map<string, TradingHaltEvent>();
  for (const h of [
    ...clusterLuldHalts.map(storedToEvent),
    ...clusterUwHalts.map(storedToEvent),
    ...localLuld,
    ...localUw,
  ]) {
    bySym.set(h.symbol.toUpperCase(), h);
  }
  return Array.from(bySym.values());
}
