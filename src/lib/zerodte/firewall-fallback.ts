/**
 * Cluster-visible last-known-good store for Phase-0 firewall inputs (VIX, macro, earnings).
 *
 * Problem this fixes (2026-08-04 stack audit):
 * 1. Per-process module caches made the same scan inputs diverge across ECS replicas.
 * 2. A 30-minute fallback suppressed `*Unavailable` for the entire window — fail-closed never
 *    fired during real outages under 30m.
 *
 * Policy:
 * - Fresh read → store in Redis (when configured) + local L1; `unavailable=false`.
 * - Miss with fallback age < FAIL_CLOSED_STALE_MS (5m) → use stale value; `unavailable=false`
 *   (absorbs transient blips without emptying the board).
 * - Miss with fallback age ≥ FAIL_CLOSED_STALE_MS and < MAX_AGE_MS (30m) → use stale value for
 *   calibration/display but `unavailable=true` so G-4/G-7/G-11 fail-closed paths can fire.
 * - No fallback or age ≥ MAX_AGE_MS → `unavailable=true`, value null.
 */

import type { EarningsFlag } from "./board";
import type { MacroEventLike } from "@/lib/macro-hard-block";

/** Max age to USE a stale value at all (display / calibration). */
export const FIREWALL_FALLBACK_MAX_AGE_MS = 30 * 60 * 1000;
/** After this age without a fresh read, trip `unavailable` even if a stale value exists. */
export const FIREWALL_FAIL_CLOSED_STALE_MS = 5 * 60 * 1000;

type StoredAt = { at: number };

type RedisClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: string, ttlSec: number): Promise<unknown>;
};

const localNumeric = new Map<string, { at: number; value: number }>();
const localMacro = new Map<string, { at: number; events: MacroEventLike[] }>();
const localEarnings = new Map<
  string,
  { at: number; payload: { map: Map<string, EarningsFlag>; unavailable: boolean } }
>();

let sharedRedis: RedisClient | null = null;
let sharedRedisFailedAt = 0;
const REDIS_RETRY_MS = 60_000;

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function firewallFallbackMaxAgeMs(): number {
  return envInt("ZERODTE_FIREWALL_FALLBACK_MAX_MS", FIREWALL_FALLBACK_MAX_AGE_MS);
}

export function firewallFailClosedStaleMs(): number {
  return envInt("ZERODTE_FIREWALL_FAIL_CLOSED_STALE_MS", FIREWALL_FAIL_CLOSED_STALE_MS);
}

async function getRedis(): Promise<RedisClient | null> {
  if (sharedRedisFailedAt && Date.now() - sharedRedisFailedAt < REDIS_RETRY_MS) return null;
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (sharedRedis) return sharedRedis;
  try {
    const { makeRedis } = await import("../make-redis");
    const client = await makeRedis("zerodte-firewall-fallback", url, { maxRetriesPerRequest: 1 });
    sharedRedis = client as unknown as RedisClient;
    sharedRedisFailedAt = 0;
    return sharedRedis;
  } catch {
    sharedRedisFailedAt = Date.now();
    return null;
  }
}

function unavailableFromAge(ageMs: number, maxAge: number, failClosedStale: number): boolean {
  if (ageMs >= maxAge) return true;
  return ageMs >= failClosedStale;
}

function redisKey(kind: string, sessionYmd: string): string {
  return `zerodte:fw:${kind}:${sessionYmd}`;
}

async function readStored<T extends StoredAt>(kind: string, sessionYmd: string): Promise<T | null> {
  const key = redisKey(kind, sessionYmd);
  const redis = await getRedis();
  if (redis) {
    try {
      const raw = await redis.get(key);
      if (raw) return JSON.parse(raw) as T;
    } catch {
      /* fall through to L1 */
    }
  }
  return null;
}

async function writeStored(
  kind: string,
  sessionYmd: string,
  payload: StoredAt & Record<string, unknown>
): Promise<void> {
  const key = redisKey(kind, sessionYmd);
  const redis = await getRedis();
  if (redis) {
    try {
      await redis.set(key, JSON.stringify(payload), "EX", 7200);
    } catch {
      /* L1 still holds the write */
    }
  }
}

export type FirewallNumericResult = {
  value: number | null;
  unavailable: boolean;
  fromFallback: boolean;
};

/** Resolve day-open VIX (or any numeric firewall input) with cluster LKG + fail-closed stale policy. */
export async function resolveFirewallNumeric(
  sessionYmd: string,
  kind: "vix",
  fresh: number | null | undefined,
  nowMs: number = Date.now()
): Promise<FirewallNumericResult> {
  const maxAge = firewallFallbackMaxAgeMs();
  const failStale = firewallFailClosedStaleMs();
  const lkey = `${kind}:${sessionYmd}`;

  if (fresh != null && Number.isFinite(fresh)) {
    const row = { at: nowMs, value: fresh };
    localNumeric.set(lkey, row);
    await writeStored(kind, sessionYmd, row);
    return { value: fresh, unavailable: false, fromFallback: false };
  }

  let fb = localNumeric.get(lkey) ?? null;
  if (!fb) {
    const fromRedis = await readStored<{ at: number; value: number }>(kind, sessionYmd);
    if (fromRedis?.value != null && Number.isFinite(fromRedis.value)) {
      fb = { at: fromRedis.at, value: fromRedis.value };
      localNumeric.set(lkey, fb);
    }
  }

  if (!fb) return { value: null, unavailable: true, fromFallback: false };

  const age = nowMs - fb.at;
  if (age >= maxAge) return { value: null, unavailable: true, fromFallback: false };

  return {
    value: fb.value,
    unavailable: unavailableFromAge(age, maxAge, failStale),
    fromFallback: true,
  };
}

export type FirewallMacroResult = {
  events: MacroEventLike[];
  unavailable: boolean;
  fromFallback: boolean;
};

export async function resolveFirewallMacro(
  sessionYmd: string,
  fresh: MacroEventLike[] | null | undefined,
  nowMs: number = Date.now()
): Promise<FirewallMacroResult> {
  const maxAge = firewallFallbackMaxAgeMs();
  const failStale = firewallFailClosedStaleMs();
  const lkey = `macro:${sessionYmd}`;

  if (fresh != null) {
    const row = { at: nowMs, events: fresh };
    localMacro.set(lkey, row);
    await writeStored("macro", sessionYmd, row);
    return { events: fresh, unavailable: false, fromFallback: false };
  }

  let fb = localMacro.get(lkey) ?? null;
  if (!fb) {
    const fromRedis = await readStored<{ at: number; events: MacroEventLike[] }>("macro", sessionYmd);
    if (fromRedis?.events) {
      fb = { at: fromRedis.at, events: fromRedis.events };
      localMacro.set(lkey, fb);
    }
  }

  if (!fb) return { events: [], unavailable: true, fromFallback: false };

  const age = nowMs - fb.at;
  if (age >= maxAge) return { events: [], unavailable: true, fromFallback: false };

  return {
    events: fb.events,
    unavailable: unavailableFromAge(age, maxAge, failStale),
    fromFallback: true,
  };
}

export type FirewallEarningsResult = {
  map: Map<string, EarningsFlag>;
  unavailable: boolean;
  fromFallback: boolean;
};

export async function resolveFirewallEarnings(
  sessionYmd: string,
  fresh: { map: Map<string, EarningsFlag>; unavailable: boolean } | null | undefined,
  nowMs: number = Date.now()
): Promise<FirewallEarningsResult> {
  const maxAge = firewallFallbackMaxAgeMs();
  const failStale = firewallFailClosedStaleMs();
  const lkey = `earnings:${sessionYmd}`;

  if (fresh != null && !fresh.unavailable) {
    const row = { at: nowMs, payload: { map: fresh.map, unavailable: false } };
    localEarnings.set(lkey, row);
    await writeStored("earnings", sessionYmd, {
      at: row.at,
      map: [...fresh.map.entries()],
      unavailable: false,
    });
    return { map: fresh.map, unavailable: false, fromFallback: false };
  }

  let fb = localEarnings.get(lkey) ?? null;
  if (!fb) {
    const fromRedis = await readStored<{
      at: number;
      map: [string, EarningsFlag][];
      unavailable: boolean;
    }>("earnings", sessionYmd);
    if (fromRedis?.map) {
      fb = {
        at: fromRedis.at,
        payload: { map: new Map(fromRedis.map), unavailable: false },
      };
      localEarnings.set(lkey, fb);
    }
  }

  if (!fb) {
    return {
      map: fresh?.map ?? new Map(),
      unavailable: fresh?.unavailable ?? true,
      fromFallback: false,
    };
  }

  const age = nowMs - fb.at;
  if (age >= maxAge) return { map: new Map(), unavailable: true, fromFallback: false };

  return {
    map: fb.payload.map,
    unavailable: unavailableFromAge(age, maxAge, failStale),
    fromFallback: true,
  };
}

/** Test-only reset. */
export function resetFirewallFallbackStoresForTests(): void {
  localNumeric.clear();
  localMacro.clear();
  localEarnings.clear();
  sharedRedis = null;
  sharedRedisFailedAt = 0;
}
