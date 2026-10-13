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
  /**
   * Test-only override for the staleness ceiling every `return hit.value` site in this function
   * enforces (default MAX_STALE_AGE_MS, 10 minutes). Mirrors `peekServerCache`'s own `maxStaleMs`
   * option — lets a unit test exercise the ceiling with a real (tiny) elapsed time instead of a
   * real 10-minute wait. No production caller should ever need to pass this; the shared default
   * is what keeps every site in this function agreeing on "how old is too old."
   */
  maxStaleAgeMs?: number;
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
  const maxStaleAgeMs = opts.maxStaleAgeMs ?? MAX_STALE_AGE_MS;
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

  // Fast lanes: always await a fresh build once TTL expires (no stale handoff) — but only for a
  // hit that is still within MAX_STALE_AGE_MS. BUG (found live 2026-10-08, /api/market/spx/play):
  // before this ceiling existed, BOTH `return hit.value` sub-paths below served the in-memory
  // entry completely unconditionally, however old it was — unlike the SWR branch a few lines
  // down, which has always enforced MAX_STALE_AGE_MS via the "FIX 5a" guard. Every caller that
  // combines `staleWhileRevalidate:false` with `staleOnInflight`/`maxBlockMs` (today just
  // spx-service.ts's getSpxPlayState, the sole `staleWhileRevalidate:false` caller) hits this
  // exact fast lane. When its loader (evaluateSpxPlayStateCrossReplica) routinely lost its race
  // against its own 800ms maxBlockMs — already documented inline at that call site as "a routine
  // outcome, not a rare one" — the background refresh scheduled here kept failing to land before
  // the NEXT poll arrived, so this replica's in-memory `hit` just sat there, un-aged-out, served
  // forever. Measured live: `/api/market/spx/play`'s `as_of` up to ~27 minutes stale and
  // inconsistent across replicas (each replica frozen at whenever ITS OWN background refresh last
  // happened to succeed), `assessed: true` and indistinguishable from a fresh read the whole time,
  // while `/api/market/spx/desk` (same underlying desk snapshot, but a route that does not pass
  // staleWhileRevalidate:false) stayed current throughout the identical polling window — proving
  // the staleness was this cache path's own gap, not an upstream data problem. Falling through
  // past the ceiling re-enters the SAME bounded cold-path logic a genuinely-cold key already uses
  // below (the `pending`/maxBlockMs-raced rebuild, then fallback, with the ceiling re-checked
  // before any remaining `hit`-as-last-resort step — see the matching fix at each of those sites)
  // instead of a third, unbounded way to serve `hit.value`.
  if (hit && hit.expiresAt <= now && !swr && now - hit.refreshedAt <= maxStaleAgeMs) {
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
  // `&& swr` restricts this block to stale-while-revalidate callers specifically (it always
  // implicitly was, in effect, since the fast lane above used to consume every `!swr` hit
  // unconditionally and never fell through to here — now that the fast lane itself has a
  // staleness ceiling, an explicit `swr` check keeps a too-stale `!swr` hit routing to the
  // `pending`/maxBlockMs cold-path logic further down instead of this block's own unbounded
  // `return refreshCache(...)` on the "not yet degraded" branch, which has no maxBlockMs race at
  // all and would silently reintroduce the exact unbounded-block failure mode PR #5061/#5065
  // fixed for every `maxBlockMs` caller).
  if (hit && hit.expiresAt <= now && swr && !inflight.has(key)) {
    const staleAge = now - hit.refreshedAt;
    if (staleAge > maxStaleAgeMs) {
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
      // Same MAX_STALE_AGE_MS ceiling as the fast-lane fix above — this branch is reachable by
      // ANY caller with staleOnInflight/maxBlockMs+fallback configured (not just !swr ones, e.g.
      // spx-desk-loader.ts, nighthawk/edition/route.ts, flows-member-cache.ts, admin-health.ts),
      // whenever a build happens to already be inflight. An ancient `hit` here is just as
      // unbounded-stale as the fast-lane one was; treat it as unusable past the ceiling and fall
      // through to the Redis/fallback logic below instead of serving it unconditionally.
      if (hit && now - hit.refreshedAt <= maxStaleAgeMs) return hit.value;
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
      if (opts.fallback) {
        // BUG (found live 2026-09-16): this branch is reached when a build for `key` is
        // already inflight (from a concurrent caller) AND there's no hit/Redis copy to
        // serve — a fully cold key under concurrent load, e.g. right after a deploy cycles
        // tasks or a session-date rollover. Unlike the cold-start path below (which races
        // its own refreshCache() against maxBlockMs), this call to opts.fallback() was
        // awaited with NO timeout at all. When the fallback itself does real work that can
        // block (spx-desk-loader.ts's desk fallback calls loadSpxDeskPulse(), itself a
        // withServerCache-wrapped builder that can hit a slow upstream), a caller landing
        // here has no bound on how long it waits — measured live: /api/market/spx/desk
        // returned in 42.8s against a documented 3s maxBlockMs cap (deskBootstrapMaxBlockMs()),
        // a ~14x overshoot, while ALB TargetResponseTime showed a sustained sitewide avg
        // climb to ~11-13s for several minutes. Race it the same way the path below does,
        // so a slow fallback can never block longer than the caller's own configured cap.
        const maxBlock = opts.maxBlockMs;
        if (maxBlock != null && Number.isFinite(maxBlock) && maxBlock > 0) {
          const racedFallback = await Promise.race([
            opts.fallback() as Promise<T>,
            new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), maxBlock)),
          ]);
          if (racedFallback !== "timeout") return racedFallback;
          throw new Error(`[server-cache] ${key}: cold miss (inflight, fallback) exceeded maxBlockMs`);
        }
        return opts.fallback() as Promise<T>;
      }
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
    if (opts.fallback) {
      // BUG, part 2 (found live 2026-09-16, same shape as the "already inflight" branch
      // above): this is the COLD-START path — no build was already inflight, so `refresh`
      // itself just raced against maxBlockMs and lost. Falling through to opts.fallback()
      // here was ALSO awaited with no timeout, so a slow fallback (spx-desk-loader.ts's
      // deskCacheOpts.fallback calls loadSpxDeskPulse(), itself a withServerCache-wrapped
      // builder that can hit a slow Polygon fetch) could still block the caller far past
      // maxBlockMs even after the fix above landed — confirmed live post-deploy: PR #5061
      // shipped the "already inflight" fix, but /api/market/spx/desk still measured a 42.2s
      // response afterward, because on a genuinely cold key (the far more common case — no
      // concurrent request racing the same build) execution lands HERE, not in the inflight
      // branch. Race it the same way.
      const racedFallback = await Promise.race([
        opts.fallback() as Promise<T>,
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), maxBlock)),
      ]);
      if (racedFallback !== "timeout") return racedFallback;
      // Fallback also blew the cap — fall through to stale/background-refresh below rather
      // than waiting on it further.
    }
    // Same MAX_STALE_AGE_MS ceiling as the two sites above — this is the cold-start mirror of the
    // "already inflight" fix just above (reachable by any maxBlockMs caller once both the fresh
    // build and the fallback have blown the cap), and had the identical unbounded `if (hit) return
    // hit.value` gap.
    if (hit && now - hit.refreshedAt <= maxStaleAgeMs) return hit.value;
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

/**
 * Read a cached value without invoking the loader (in-memory + Redis, capped read).
 *
 * BUG (found 2026-09-11, live on `/api/market/spx/play`): unlike `withServerCache`, this had NO
 * staleness ceiling on the final fallback (`if (hit) return hit.value;`). Every "instant read, fire
 * a background refresh" route (spx/play via `peekSpxPlayState`, nighthawk/edition, spx-desk-loader,
 * flows-member-cache, flow-brief) calls this FIRST and returns whatever it gets immediately, with no
 * freshness check of its own — the staleness bound was assumed to live here.
 *
 * `store` is a per-PROCESS in-memory Map (one per ECS replica), and `writeRedisCache` sets the Redis
 * copy's TTL to the SAME short `ttlMs` as the in-memory entry (5s for spx-play-read) — so once ~5s
 * pass with no fresh write anywhere, the Redis backstop expires too. A replica that only occasionally
 * serves traffic then has nothing to refresh its own local entry, and this function's old fallback
 * happily returned that entry's `.value` no matter how old — measured live: `as_of` timestamps 20+
 * minutes stale, and three consecutive polls from the SAME client landing on different replicas
 * returned three DIFFERENT scores (24, 10, then a correctly-fresh 0), because each replica's local
 * cache lagged independently with no shared floor.
 *
 * Fix: apply the identical `MAX_STALE_AGE_MS` ceiling `withServerCache` already enforces (see the
 * "FIX 5a" comment above) to the LOCAL-fallback path here too — measured from the entry's own
 * `refreshedAt`, not `expiresAt` (an entry can be long past its TTL while still well under the
 * staleness ceiling; those two are deliberately different budgets). Once a locally-cached entry is
 * older than the ceiling AND Redis has nothing newer, this now returns `null` instead of the stale
 * value, so every caller's existing "peek → null → do a real blocking compute" fallback path (already
 * the design in every route listed above) kicks in rather than silently handing out ancient data.
 * `maxStaleMs` is overridable (default `MAX_STALE_AGE_MS`) purely so a regression test can exercise
 * the ceiling without a real 10-minute wait; no caller currently overrides it.
 */
export async function peekServerCache<T>(key: string, opts?: { maxStaleMs?: number }): Promise<T | null> {
  const maxStaleMs = opts?.maxStaleMs ?? MAX_STALE_AGE_MS;
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
  if (hit && now - hit.refreshedAt <= maxStaleMs) return hit.value;
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
