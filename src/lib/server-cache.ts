type CacheEntry<T> = {
  value: T;
  expiresAt: number;
  /** Wall-clock time the entry was last successfully refreshed. */
  refreshedAt: number;
};

/** Tracks consecutive revalidation failures per cache key. */
const failureCount = new Map<string, number>();
/** Keys whose upstream is considered degraded (>= FAILURE_THRESHOLD failures). */
const degradedKeys = new Set<string>();

/** Number of consecutive revalidation failures before marking a key degraded. */
const FAILURE_THRESHOLD = 3;
/**
 * Maximum age (ms) of a stale entry that will still be served during SWR.
 * After this window, null / a fresh fetch is forced instead of returning
 * perpetually stale data.
 */
const MAX_STALE_AGE_MS = 10 * 60 * 1000; // 10 minutes

const store = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * Hard cap on distinct in-memory cache entries. User-controlled keys (e.g.
 * ticker-search `search:${q}:${limit}`) could otherwise grow the Map without
 * bound — a memory-DoS. JS Map preserves insertion order, so the oldest key is
 * always store.keys().next().value, giving us cheap insertion-order eviction.
 */
const MAX_ENTRIES = 5_000;

/**
 * Hard cap on the failure-tracking sidecar structures. Failing keys never enter `store`
 * (the .then that writes the store only runs on success), so they cannot be bounded by
 * setStoreEntry's eviction — without their own cap, a sustained upstream outage over
 * high-cardinality user-controlled keys leaks one permanent entry per distinct failing
 * key. Bound them directly, insertion-order eviction, keeping degradedKeys a strict subset.
 */
const MAX_FAILURE_KEYS = 5_000;

/**
 * Insert/refresh a store entry while keeping the Map bounded. Opportunistically
 * sweeps expired keys first (so a flood of short-TTL keys self-cleans), then
 * evicts oldest entries until under MAX_ENTRIES. Centralizing every store.set
 * here is what makes the bound actually hold.
 */
function setStoreEntry(key: string, entry: CacheEntry<unknown>): void {
  // Re-inserting an existing key must move it to the most-recently-used position,
  // otherwise a hot key could be evicted as "oldest" while cold keys survive.
  store.delete(key);

  // Sweep expired entries only when we're at/over the cap, to keep the common
  // (uncrowded) path O(1) instead of scanning the whole Map on every write.
  if (store.size >= MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of Array.from(store)) {
      if (v.expiresAt <= now) store.delete(k);
    }
    // If sweeping wasn't enough (all live), evict oldest by insertion order.
    while (store.size >= MAX_ENTRIES) {
      const oldest = store.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }

  store.set(key, entry);
}

type CacheOpts = {
  staleWhileRevalidate?: boolean;
  /** If true, callers can detect upstream degradation via isDegraded(). */
  trackDegradation?: boolean;
  /**
   * When true, this entry lives ONLY in the in-process store (the Redis L1/L2 layer is
   * skipped on both read and write). Use for HIGH-CARDINALITY, replica-LOCAL, short-TTL
   * keys — e.g. a per-user poll-collapse cache — where the value is specific to this
   * replica's in-memory state (live WS marks) and pushing it to shared Redis would only
   * pollute it with thousands of ephemeral per-user payloads for no cross-replica benefit.
   * The in-flight single-flight dedup STILL applies, which is the whole point for collapsing
   * a user's concurrent tabs / rapid re-polls into one loader run. Defaults to false
   * (Redis-backed) so every existing caller is unchanged.
   */
  localOnly?: boolean;
  /**
   * When a refresh is already in-flight, return stale / Redis / fallback instead of awaiting
   * the pending build. Prevents concurrent pulse polls from piling up behind one slow cold
   * replica (audit 2026-07-30: 4/5 pulse XHRs timed out at 12s waiting on single-flight).
   */
  staleOnInflight?: boolean;
  /** Hard cap (ms) on how long a cold miss may block before serving fallback. */
  maxBlockMs?: number;
  /** Served when maxBlockMs fires or staleOnInflight finds no stale/Redis copy. */
  fallback?: () => Promise<unknown>;
  /**
   * When provided, a loader result that returns false is served but NOT written to the
   * in-memory / Redis cache. Use for payloads that must not poison SWR (e.g. Night Hawk
   * pre-publish empty shells with available:false).
   */
  shouldCache?: (value: unknown) => boolean;
};

/**
 * Returns true if the upstream for `key` has exceeded FAILURE_THRESHOLD
 * consecutive revalidation failures.  Callers can use this to surface a
 * warning UI or skip non-critical enrichment.
 */
export function isDegraded(key: string): boolean {
  return degradedKeys.has(key);
}

/** Cold-path Redis reads must never wedge member polls behind a slow ElastiCache hop. */
const REDIS_READ_RACE_MS = 500;

async function readRedisCache<T>(key: string): Promise<{ value: T; remainingTtlSec: number } | null> {
  if (!process.env.REDIS_URL?.trim()) return null;
  try {
    const { sharedCacheGetWithTtl } = await import("./shared-cache");
    const read = sharedCacheGetWithTtl<T>(`server:${key}`);
    const raced = await Promise.race([
      read,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), REDIS_READ_RACE_MS)),
    ]);
    return raced;
  } catch {
    return null;
  }
}

async function writeRedisCache<T>(key: string, value: T, ttlMs: number): Promise<void> {
  if (!process.env.REDIS_URL?.trim() || ttlMs <= 0) return;
  try {
    const { sharedCacheSet } = await import("./shared-cache");
    await sharedCacheSet(`server:${key}`, value, Math.max(1, Math.round(ttlMs / 1000)));
  } catch {
    // ignore redis write failures
  }
}

/** In-process TTL cache with in-flight dedup + optional stale-while-revalidate + Redis layer. */
export async function withServerCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  opts: CacheOpts = {}
): Promise<T> {
  const swr = opts.staleWhileRevalidate !== false;
  const localOnly = opts.localOnly === true;
  const shouldCache = opts.shouldCache;
  if (ttlMs <= 0) return loader();

  const now = Date.now();
  const hit = store.get(key) as CacheEntry<T> | undefined;

  if (hit && hit.expiresAt > now) {
    return hit.value;
  }

  // localOnly keys never touch the Redis layer — high-cardinality, replica-local, ephemeral.
  if (!hit && !localOnly) {
    const redisHit = await readRedisCache<T>(key);
    if (redisHit != null) {
      // Use the remaining TTL from Redis, not the full configured TTL, so the
      // in-memory entry expires in sync with the Redis key.
      const remainingMs = redisHit.remainingTtlSec * 1000;
      setStoreEntry(key, { value: redisHit.value, expiresAt: now + remainingMs, refreshedAt: now });
      return redisHit.value;
    }
  }

  // Fast lanes: always await a fresh build once TTL expires (no stale handoff).
  if (hit && hit.expiresAt <= now && !swr) {
    if (inflight.has(key)) {
      if (opts.staleOnInflight) return hit.value;
      if (opts.maxBlockMs != null && opts.fallback) return opts.fallback() as Promise<T>;
      return inflight.get(key) as Promise<T>;
    }
    const maxBlock = opts.maxBlockMs;
    if (maxBlock != null && Number.isFinite(maxBlock) && maxBlock > 0) {
      // Expired fast lane with a stale copy: never block member polls on rebuild.
      scheduleBackgroundRefresh(key, ttlMs, loader, localOnly, shouldCache);
      return hit.value;
    }
    return refreshCache(key, ttlMs, loader, localOnly, shouldCache);
  }

  // Cache expired but we have data — return stale immediately, refresh in background.
  // FIX 5a: Enforce a maximum stale age. If the entry is older than MAX_STALE_AGE_MS
  // since its last successful refresh, do not serve it; fall through to a blocking
  // fetch so callers are never permanently stuck on stale data.
  if (hit && hit.expiresAt <= now && !inflight.has(key)) {
    const staleAge = now - hit.refreshedAt;
    if (staleAge > MAX_STALE_AGE_MS) {
      // When the upstream is already degraded (3+ consecutive failures), a blocking
      // refresh will almost certainly fail again, adding latency for no benefit.
      // Return the stale entry and kick off a non-blocking refresh attempt instead.
      if (degradedKeys.has(key) && hit) {
        console.warn(`[server-cache] ${key}: degraded upstream, serving stale (age ${Math.round(staleAge / 1000)}s) instead of blocking refresh`);
        refreshCacheInBackground(key, ttlMs, loader, localOnly, shouldCache);
        return hit.value;
      }
      return refreshCache(key, ttlMs, loader, localOnly, shouldCache);
    }
    if (!localOnly) {
      const redisHit = await readRedisCache<T>(key);
      if (redisHit != null) {
        const remainingMs = redisHit.remainingTtlSec * 1000;
        setStoreEntry(key, { value: redisHit.value, expiresAt: now + remainingMs, refreshedAt: now });
        refreshCacheInBackground(key, ttlMs, loader, localOnly, shouldCache);
        return redisHit.value;
      }
    }
    refreshCacheInBackground(key, ttlMs, loader, localOnly, shouldCache);
    return hit.value;
  }

  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) {
    if (opts.staleOnInflight || (opts.maxBlockMs != null && opts.fallback)) {
      if (hit) return hit.value;
      if (!localOnly) {
        const redisHit = await readRedisCache<T>(key);
        if (redisHit != null) {
          const remainingMs = redisHit.remainingTtlSec * 1000;
          setStoreEntry(key, {
            value: redisHit.value,
            expiresAt: now + remainingMs,
            refreshedAt: now,
          });
          return redisHit.value;
        }
      }
      if (opts.fallback) return opts.fallback() as Promise<T>;
    }
    return pending;
  }

  const maxBlock = opts.maxBlockMs;
  if (maxBlock != null && Number.isFinite(maxBlock) && maxBlock > 0) {
    const refresh = refreshCache(key, ttlMs, loader, localOnly, shouldCache);
    const raced = await Promise.race([
      refresh,
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), maxBlock)),
    ]);
    if (raced !== "timeout") return raced;
    if (opts.fallback) return opts.fallback() as Promise<T>;
    if (hit) return hit.value;
    // Never await the slow cold build after the cap — keep refreshing in background.
    refreshCacheInBackground(key, ttlMs, loader, localOnly, shouldCache);
    const pending = inflight.get(key) as Promise<T> | undefined;
    if (pending) {
      const racedPending = await Promise.race([
        pending,
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), maxBlock)),
      ]);
      if (racedPending !== "timeout") return racedPending;
    }
    throw new Error(`[server-cache] ${key}: cold miss exceeded maxBlockMs`);
  }

  return refreshCache(key, ttlMs, loader, localOnly, shouldCache);
}

// ---------------------------------------------------------------------------
// Standard TTLs — shared constants so route files and run-tool.ts use the
// same durations without magic numbers scattered across the codebase.
// ---------------------------------------------------------------------------
export const TTL = {
  MARKET_SNAPSHOT: 5_000,       // 5 seconds — live price data
  OPTIONS_CHAIN:   30_000,      // 30 seconds
  NEWS:            120_000,     // 2 minutes
  ANALYST:         300_000,     // 5 minutes
  EARNINGS:        300_000,     // 5 minutes
  REFERENCE:       3_600_000,   // 1 hour
  TICKER_SEARCH:   300_000,     // 5 minutes
  TICKER_NEWS:     60_000,      // 1 minute — per-ticker news (higher cardinality than market-wide)
  IPO_CALENDAR:    3_600_000,   // 1 hour
  DARK_POOL:       30_000,      // 30 seconds
  MARKET_TIDE:     60_000,      // 1 minute
} as const;

/**
 * Convenience alias for withServerCache — matches the simpler signature used
 * in route files that don't need stale-while-revalidate control.
 * 500 concurrent users share ONE upstream call per TTL window.
 */
export async function serverCache<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T> {
  return withServerCache(key, ttlMs, fn);
}

/** Read a cached value without invoking the loader (in-memory + Redis, capped read). */
export async function peekServerCache<T>(key: string): Promise<T | null> {
  const now = Date.now();
  const hit = store.get(key) as CacheEntry<T> | undefined;
  if (hit && hit.expiresAt > now) return hit.value;
  const redisHit = await readRedisCache<T>(key);
  if (redisHit != null) {
    setStoreEntry(key, {
      value: redisHit.value,
      expiresAt: now + redisHit.remainingTtlSec * 1000,
      refreshedAt: now,
    });
    return redisHit.value;
  }
  if (hit) return hit.value;
  return null;
}

/** Fire-and-forget SWR refresh — must never surface as an unhandledRejection (prod #1261). */
function refreshCacheInBackground<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  localOnly = false,
  shouldCache?: (value: unknown) => boolean
): void {
  void refreshCache(key, ttlMs, loader, localOnly, shouldCache).catch(() => undefined);
}

/** Defer background refresh so fast-lane callers return stale before the loader runs. */
function scheduleBackgroundRefresh<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  localOnly = false,
  shouldCache?: (value: unknown) => boolean
): void {
  queueMicrotask(() => {
    if (inflight.has(key)) return;
    refreshCacheInBackground(key, ttlMs, loader, localOnly, shouldCache);
  });
}

async function refreshCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  localOnly = false,
  shouldCache?: (value: unknown) => boolean
): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = loader()
    .then((value) => {
      const refreshedAt = Date.now();
      if (!shouldCache || shouldCache(value)) {
        setStoreEntry(key, { value, expiresAt: refreshedAt + ttlMs, refreshedAt });
        // localOnly keys never propagate to Redis (replica-local, ephemeral, high-cardinality).
        if (!localOnly) void writeRedisCache(key, value, ttlMs);
      }
      // FIX 5b: Successful refresh — reset failure tracking for this key.
      failureCount.delete(key);
      degradedKeys.delete(key);
      return value;
    })
    .catch((err: unknown) => {
      // FIX 5b: Track consecutive failures and flag key as degraded after threshold.
      const failures = (failureCount.get(key) ?? 0) + 1;
      failureCount.set(key, failures);
      // Bound the failure-tracking maps (they never enter `store`, so store-eviction can't
      // clean them). Evict oldest by insertion order, keeping degradedKeys in lockstep.
      while (failureCount.size > MAX_FAILURE_KEYS) {
        const oldest = failureCount.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        failureCount.delete(oldest);
        degradedKeys.delete(oldest);
      }
      if (failures >= FAILURE_THRESHOLD) {
        degradedKeys.add(key);
        console.error(
          `[server-cache] CRITICAL: upstream for cache key "${key}" has failed ` +
            `${failures} consecutive time(s). Serving stale data where available. ` +
            `Error: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      throw err;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}
