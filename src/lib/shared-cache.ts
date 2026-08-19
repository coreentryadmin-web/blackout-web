type MemoryEntry = { value: string; expiresAt: number };

const memory = new Map<string, MemoryEntry>();

// The in-memory map is the Redis-FALLBACK copy, written on EVERY sharedCacheSet (even when Redis is
// up). Previously it was never swept (audit §3.3) — quote:/nw:optmark:/server: keys accumulated for
// the whole process lifetime. Bound it with the same insertion-order LRU + sweep-on-cap pattern as
// server-cache.ts:setStoreEntry.
const MAX_MEMORY_ENTRIES = 5_000;

function setMemoryEntry(key: string, entry: MemoryEntry): void {
  memory.delete(key); // re-insert → most-recently-used position, so hot keys aren't evicted as "oldest"
  if (memory.size >= MAX_MEMORY_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of Array.from(memory)) {
      if (v.expiresAt <= now) memory.delete(k); // reclaim expired before evicting live keys
    }
    while (memory.size >= MAX_MEMORY_ENTRIES) {
      const oldest = memory.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      memory.delete(oldest);
    }
  }
  memory.set(key, entry);
}

type RedisClient = {
  get(key: string): Promise<string | null>;
  /** List ops — the append-only primitive behind sharedListAppend/sharedListRange. Present on
   *  ioredis; typed here structurally and probed at runtime so a client without them degrades to
   *  the in-memory fallback rather than throwing. */
  rpush?(key: string, ...values: string[]): Promise<number>;
  lrange?(key: string, start: number, stop: number): Promise<string[]>;
  ltrim?(key: string, start: number, stop: number): Promise<unknown>;
  expire?(key: string, ttlSec: number): Promise<unknown>;
  // Variadic to cover both the plain `SET key val EX ttl` write and the atomic claim
  // `SET key val EX ttl NX` (see sharedCacheSetNx). ioredis returns "OK" on a successful SET and
  // null when an NX SET is refused because the key already exists.
  set(key: string, value: string, ...args: (string | number)[]): Promise<unknown>;
  del(key: string): Promise<unknown>;
  ttl(key: string): Promise<number>;
};

let redisClient: RedisClient | null | undefined;
let redisInitPromise: Promise<RedisClient | null> | null = null;
// Track last failure time instead of a permanent flag; retry after backoff.
const RETRY_BACKOFF_MS = 30_000;
/** Never block member polls on a wedged ElastiCache hop — fall through to in-memory. */
const REDIS_GET_RACE_MS = 500;
let lastFailedAt = 0;

async function redisGetWithTimeout(redis: RedisClient, key: string): Promise<string | null> {
  return Promise.race([
    redis.get(key),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), REDIS_GET_RACE_MS)),
  ]);
}

function redisEnabled(): boolean {
  return Boolean(process.env.REDIS_URL?.trim());
}

async function getRedis(): Promise<RedisClient | null> {
  if (!redisEnabled()) return null;
  if (redisClient) return redisClient;
  // If a recent failure is within the backoff window, skip retry.
  if (lastFailedAt && Date.now() - lastFailedAt < RETRY_BACKOFF_MS) return null;
  if (redisInitPromise) return redisInitPromise;

  redisInitPromise = (async () => {
    try {
      const { makeRedis } = await import("./make-redis");
      const client = await makeRedis("shared-cache", process.env.REDIS_URL!.trim(), {
        maxRetriesPerRequest: 1,
      });
      redisClient = client as unknown as RedisClient;
      lastFailedAt = 0; // clear failure on success
      return redisClient;
    } catch (error) {
      lastFailedAt = Date.now();
      redisInitPromise = null; // allow retry after backoff
      console.warn("[shared-cache] Redis unavailable — using in-memory fallback", error);
      return null;
    }
  })();

  return redisInitPromise;
}

export async function sharedCacheGet<T>(key: string): Promise<T | null> {
  const redis = await getRedis();
  if (redis) {
    try {
      const raw = await redisGetWithTimeout(redis, `blackout:${key}`);
      if (raw) return JSON.parse(raw) as T;
    } catch {
      // fall through to memory
    }
  }

  const hit = memory.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return JSON.parse(hit.value) as T;
  }
  return null;
}

/**
 * Like sharedCacheGet but also returns the remaining TTL in seconds from Redis
 * (-1 means no expiry, -2 means key not found, null means Redis unavailable).
 * Used by server-cache to re-seed the in-memory layer with the correct remaining TTL.
 */
export async function sharedCacheGetWithTtl<T>(
  key: string
): Promise<{ value: T; remainingTtlSec: number } | null> {
  const redis = await getRedis();
  if (redis) {
    try {
      const redisKey = `blackout:${key}`;
      const [raw, ttl] = await Promise.all([
        redisGetWithTimeout(redis, redisKey),
        Promise.race([
          redis.ttl(redisKey),
          new Promise<number>((resolve) => setTimeout(() => resolve(-2), REDIS_GET_RACE_MS)),
        ]),
      ]);
      if (raw && ttl > 0) {
        return { value: JSON.parse(raw) as T, remainingTtlSec: ttl };
      }
    } catch {
      // fall through to memory
    }
  }

  const hit = memory.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    const remainingTtlSec = Math.max(1, Math.round((hit.expiresAt - Date.now()) / 1000));
    return { value: JSON.parse(hit.value) as T, remainingTtlSec };
  }
  return null;
}

export async function sharedCacheSet(key: string, value: unknown, ttlSec: number): Promise<void> {
  const payload = JSON.stringify(value);
  setMemoryEntry(key, { value: payload, expiresAt: Date.now() + ttlSec * 1000 });

  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.set(`blackout:${key}`, payload, "EX", ttlSec);
  } catch {
    // memory copy already stored
  }
}

/**
 * Atomic "claim if absent" — the cross-replica idempotency primitive. Returns true iff THIS caller
 * won the claim (the key did not previously exist), false if someone already holds it.
 *
 * WHY NX and not sharedCacheGet-then-sharedCacheSet: a read-then-write pair is a race. Two replicas
 * firing the same cron minute can BOTH read "key absent" and BOTH proceed to write it → both run the
 * guarded work (e.g. duplicate swing discovery, double-incremented accumulation memory). `SET key val
 * NX EX ttl` is a SINGLE atomic Redis command: exactly one caller's SET creates the key and returns
 * "OK"; every concurrent caller gets nil. The winner is decided by Redis, never by the interleaving of
 * two round-trips. TTL bounds the key so it self-expires (no leak) — pass a TTL past the window the
 * claim must outlive.
 *
 * Fallback: with Redis unavailable the in-memory map gives per-PROCESS NX only (no cross-replica
 * guarantee) — the same best-effort posture as the rest of this module. A multi-replica deploy always
 * has Redis wired, so the atomic path is the one that actually runs in prod.
 */
export async function sharedCacheSetNx(key: string, value: unknown, ttlSec: number): Promise<boolean> {
  const payload = JSON.stringify(value);
  const redis = await getRedis();
  if (redis) {
    try {
      // ioredis: `set(key, val, "EX", ttl, "NX")` → "OK" when the key was created, null when refused.
      const res = await redis.set(`blackout:${key}`, payload, "EX", ttlSec, "NX");
      const acquired = res === "OK";
      // Mirror only on a win so the memory copy reflects the value the claim winner stored.
      if (acquired) setMemoryEntry(key, { value: payload, expiresAt: Date.now() + ttlSec * 1000 });
      return acquired;
    } catch {
      // fall through to the in-memory claim
    }
  }

  // In-memory NX: a live (unexpired) entry means the claim is already held in this process.
  const hit = memory.get(key);
  if (hit && hit.expiresAt > Date.now()) return false;
  setMemoryEntry(key, { value: payload, expiresAt: Date.now() + ttlSec * 1000 });
  return true;
}

export async function sharedCacheDel(key: string): Promise<void> {
  memory.delete(key);
  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.del(`blackout:${key}`);
  } catch {
    // memory copy already cleared
  }
}

/** Desk sticky lanes — GEX walls, unified tape, gamma flip (cross-instance when Redis is set). */
export const DESK_STICKY_KEYS = {
  gexWalls: "desk:sticky:gex_walls",
  strikeLevels: "desk:sticky:strike_levels",
  gammaFlip: "desk:sticky:gamma_flip",
  gammaRegime: "desk:sticky:gamma_regime",
  unifiedTape: "desk:sticky:unified_tape",
  spxFlowBriefs: "desk:sticky:spx_flow_briefs",
} as const;

export const DESK_STICKY_TTL_SEC = {
  gex: Number(process.env.SPX_REDIS_GEX_TTL_SEC ?? 120),
  tape: Number(process.env.SPX_REDIS_TAPE_TTL_SEC ?? 60),
} as const;


// ── APPEND-ONLY LISTS ────────────────────────────────────────────────────────────────
//
// WHY THIS EXISTS. `sharedCacheSet` is a whole-value write: it serialises the ENTIRE value and
// stores it. For a value that GROWS all session and is appended to every few seconds — the Vector
// bead rails — that is O(session length) of JSON per append, and the cost climbs all day.
//
// That is not a theoretical worry, it is the measured cause of a same-day revert: #2273 put all
// four rails per ticker on the 5s sweep, ~122 -> 488 whole-rail rewrites per tick, the sweep
// overran its 5s budget, and the blended rail everyone depends on regressed from 5s to 10-25s.
// #2274 reverted it. The conclusion drawn at the time was "spend the extra writes where they buy
// something"; the real problem was that a single append cost a whole-rail rewrite at all.
//
// RPUSH is O(1) and its payload is ONE sample regardless of how long the rail already is. That is
// what makes per-tick writes for every horizon affordable.
//
// TTL and trimming are handled WITHOUT an extra round trip per append: RPUSH returns the new
// length, so the TTL is set when the list is created and refreshed (with a trim) only every
// `MAINTAIN_EVERY` appends. A rail written every 5s therefore costs one command per append and
// three occasionally, instead of a growing SET every time.

/** Appends between TTL-refresh + trim maintenance. 64 x 5s ~ every 5 minutes. */
const LIST_MAINTAIN_EVERY = 64;

function memoryList(key: string): string[] {
  const hit = memory.get(key);
  if (!hit || hit.expiresAt <= Date.now()) return [];
  try {
    const parsed = JSON.parse(hit.value);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Append one entry to a bounded, TTL'd list. Returns the list's new length (0 when the append
 * could not be recorded anywhere).
 *
 * `maxLen` bounds the list from the RIGHT (newest kept) so an unexpectedly long session cannot
 * grow it without limit — the same role `compactHistoryToCap` plays for the blob form.
 */
export async function sharedListAppend(
  key: string,
  value: unknown,
  ttlSec: number,
  maxLen: number
): Promise<number> {
  const payload = JSON.stringify(value);
  const full = `blackout:${key}`;

  const redis = await getRedis();
  if (redis?.rpush) {
    try {
      const len = await redis.rpush(full, payload);
      // First append creates the key with no TTL — set it immediately, or the rail never expires.
      if (len === 1) {
        await redis.expire?.(full, ttlSec);
      } else if (len % LIST_MAINTAIN_EVERY === 0) {
        // Refresh the TTL so a session-long rail does not expire mid-session, and trim in the same
        // maintenance window rather than on every append.
        await redis.ltrim?.(full, -maxLen, -1);
        await redis.expire?.(full, ttlSec);
      }
      return len;
    } catch {
      // fall through to the memory copy
    }
  }

  const list = memoryList(full);
  list.push(payload);
  const bounded = list.length > maxLen ? list.slice(list.length - maxLen) : list;
  setMemoryEntry(full, { value: JSON.stringify(bounded), expiresAt: Date.now() + ttlSec * 1000 });
  return bounded.length;
}

/** Read a list appended by {@link sharedListAppend}. Unparseable entries are skipped, never thrown
 *  on — one bad element must not cost the caller the whole rail. */
export async function sharedListRange<T>(key: string): Promise<T[]> {
  const full = `blackout:${key}`;
  const redis = await getRedis();
  let raw: string[] | null = null;
  if (redis?.lrange) {
    try {
      raw = await redis.lrange(full, 0, -1);
    } catch {
      raw = null;
    }
  }
  if (!raw || raw.length === 0) raw = memoryList(full);

  const out: T[] = [];
  for (const entry of raw) {
    try {
      out.push(JSON.parse(entry) as T);
    } catch {
      // skip
    }
  }
  return out;
}
