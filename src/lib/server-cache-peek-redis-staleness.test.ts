import { before, test, mock } from "node:test";
import assert from "node:assert/strict";

// Regression guard for the live 2026-10-31 SPX desk/play `as_of` non-monotonicity bug: polling
// GET /api/market/spx/desk and /api/market/spx/play a few seconds apart returned a NEWER poll
// with an OLDER `as_of` (e.g. 11:28:04.915Z -> 11:27:01.497Z -> 11:15:42.214Z, ~13.5 minutes
// backward overall), and gex_age_ms bounced non-monotonically across consecutive polls.
//
// Root cause (server-cache.ts, peekServerCache): the Redis-hit branch returned `redisHit.value`
// UNCONDITIONALLY — no staleness check at all — and then re-stamped the LOCAL in-memory cache's
// `refreshedAt` to `now`, regardless of how old the Redis-cached PAYLOAD actually was. Unlike the
// local-only fallback a few lines below it (which already measures `now - hit.refreshedAt` against
// `maxStaleMs`), the Redis branch had no equivalent check against the payload's own age — only
// against Redis's remaining-TTL countdown (`remainingTtlSec`), which says nothing about when the
// value was actually produced. A key written with a long ttlMs can sit unrefreshed for most of
// that window while Redis's TTL command still reports a healthy remaining time, so a replica that
// picked up an old-but-not-yet-expired Redis copy would serve it no matter how stale, then trust
// its own now-local copy as "freshly verified" for a further `maxStaleMs` window on top.
//
// This test constructs exactly that scenario: seed Redis (via the real `writeRedisCache`, which
// also stamps the generation timestamp `server-gen:<key>` the fix reads) with a value whose
// generation is already older than `maxStaleMs`, then asserts `peekServerCache` now refuses it
// (returns null, the same "go compute fresh" signal every caller already treats a too-stale local
// hit as) instead of silently serving it. A sibling test confirms a genuinely fresh Redis value is
// still served normally — the fix must not over-correct into rejecting everything.
//
// Same mocking approach as server-cache-redis-generation.test.ts: mock ./make-redis so getRedis()
// returns a fake ioredis client with plain get/set/ttl semantics.
// Run with: node --import tsx --test --experimental-test-module-mocks src/lib/server-cache-peek-redis-staleness.test.ts

function makeFakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    client: {
      async get(key: string): Promise<string | null> {
        return store.has(key) ? store.get(key)! : null;
      },
      async set(key: string, value: string, ..._args: (string | number)[]): Promise<unknown> {
        store.set(key, value);
        return "OK";
      },
      async del(key: string): Promise<unknown> {
        return store.delete(key) ? 1 : 0;
      },
      async ttl(key: string): Promise<number> {
        // Reports a healthy remaining TTL for any key present, regardless of how old its
        // generation is — this is exactly the disconnect the bug exploited: a positive TTL says
        // nothing about the payload's real age.
        return store.has(key) ? 600 : -2;
      },
    },
  };
}

const fake = makeFakeRedis();

mock.module("./make-redis", {
  namedExports: {
    makeRedis: async () => fake.client,
  },
});

let writeRedisCache: typeof import("./server-cache").writeRedisCache;
let peekServerCache: typeof import("./server-cache").peekServerCache;

before(async () => {
  process.env.REDIS_URL = "redis://fake:6379";
  ({ writeRedisCache, peekServerCache } = await import("./server-cache"));
});

test("peekServerCache refuses a Redis-cached value whose generation is older than maxStaleMs", async () => {
  const key = `test:peek-redis-stale:${Math.random()}`;
  const staleGeneratedAt = Date.now() - 5 * 60_000; // 5 minutes old

  // Written with a long ttlMs (30 min) so Redis's own remaining TTL is still healthy/positive —
  // the exact "long TTL, unrefreshed for most of the window" shape behind the live repro.
  await writeRedisCache(key, { as_of: staleGeneratedAt, label: "stale" }, 30 * 60_000, staleGeneratedAt);

  // 40s ceiling, matching deskPeekMaxAgeSec()'s real default for peekSpxDesk()/peekMergedSpxDesk().
  const result = await peekServerCache(key, { maxStaleMs: 40_000 });
  assert.equal(
    result,
    null,
    "a Redis value whose own generation is 5 minutes old must not be served under a 40s ceiling"
  );
});

test("peekServerCache still serves a genuinely fresh Redis-cached value", async () => {
  const key = `test:peek-redis-fresh:${Math.random()}`;
  const freshGeneratedAt = Date.now() - 1_000; // 1 second old

  await writeRedisCache(key, { as_of: freshGeneratedAt, label: "fresh" }, 30 * 60_000, freshGeneratedAt);

  const result = await peekServerCache(key, { maxStaleMs: 40_000 });
  assert.deepEqual(
    result,
    { as_of: freshGeneratedAt, label: "fresh" },
    "a Redis value well within the ceiling must still be served normally — no over-correction"
  );
});

test("peekServerCache trusts a Redis hit with no generation metadata (mid-rollout compatibility)", async () => {
  const key = `test:peek-redis-no-gen:${Math.random()}`;
  // Simulate a value written without the generation sidecar key at all (e.g. a replica running
  // pre-generation-guard code) by writing directly through shared-cache rather than
  // writeRedisCache, so no `server-gen:<key>` entry ever exists for this key.
  const { sharedCacheSet } = await import("./shared-cache");
  await sharedCacheSet(`server:${key}`, { label: "no-gen-metadata" }, 1800);

  const result = await peekServerCache(key, { maxStaleMs: 40_000 });
  assert.deepEqual(
    result,
    { label: "no-gen-metadata" },
    "with no age signal available, the pre-fix (trusting) behavior must be preserved rather than " +
      "rejecting a value with no actual evidence it is stale"
  );
});
