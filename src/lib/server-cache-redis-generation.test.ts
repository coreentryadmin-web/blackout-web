import { before, test, mock } from "node:test";
import assert from "node:assert/strict";

// Regression guard for the cross-replica Redis generation guard in server-cache.ts's
// writeRedisCache (bug found live 2026-10-15: SPX desk `as_of` reverting backward across
// consecutive polls). Each ECS replica refreshes a withServerCache-backed key independently;
// before this fix, writeRedisCache's Redis write was unconditional last-writer-wins, so a
// refresh that STARTED earlier (older upstream read) but happened to COMPLETE later than a
// sibling replica's refresh could clobber the sibling's already-written NEWER result. The fix
// stamps each write with `generatedAt` (when its own loader call started) and skips the Redis
// write when a newer generation is already stored.
//
// Same mocking approach as shared-cache.test.ts: mock ./make-redis so getRedis() returns a fake
// ioredis client with plain get/set semantics (no NX needed here).
// Run with: node --import tsx --test --experimental-test-module-mocks src/lib/server-cache-redis-generation.test.ts

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
      async ttl(): Promise<number> {
        return 100;
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
let sharedCacheGet: typeof import("./shared-cache").sharedCacheGet;

before(async () => {
  process.env.REDIS_URL = "redis://fake:6379";
  ({ writeRedisCache } = await import("./server-cache"));
  ({ sharedCacheGet } = await import("./shared-cache"));
});

test("a write with an older generatedAt never clobbers an already-stored newer generation", async () => {
  const key = `test:gen-guard:${Math.random()}`;

  // Replica B's refresh started LATER (generatedAt=10) but finished FIRST.
  await writeRedisCache(key, { label: "newer", asOf: 10 }, 60_000, 10);
  // Replica A's refresh started EARLIER (generatedAt=5) but finished SECOND (the race this bug
  // was built for) — its write must be rejected, not overwrite the already-stored newer value.
  await writeRedisCache(key, { label: "older", asOf: 5 }, 60_000, 5);

  const stored = await sharedCacheGet<{ label: string; asOf: number }>(`server:${key}`);
  assert.deepEqual(
    stored,
    { label: "newer", asOf: 10 },
    "an older-generation write must not regress an already-stored newer generation"
  );
});

test("writes still advance forward in normal (non-racing) order", async () => {
  const key = `test:gen-guard-forward:${Math.random()}`;

  await writeRedisCache(key, { label: "first", asOf: 1 }, 60_000, 1);
  await writeRedisCache(key, { label: "second", asOf: 2 }, 60_000, 2);

  const stored = await sharedCacheGet<{ label: string; asOf: number }>(`server:${key}`);
  assert.deepEqual(
    stored,
    { label: "second", asOf: 2 },
    "a genuinely newer generation must still overwrite the prior one"
  );
});

test("main cache value shape is unchanged (raw T, not an envelope) — old-code compatibility", async () => {
  const key = `test:gen-guard-shape:${Math.random()}`;
  await writeRedisCache(key, { some: "payload" }, 60_000, 42);

  const stored = await sharedCacheGet<unknown>(`server:${key}`);
  assert.deepEqual(
    stored,
    { some: "payload" },
    "server:<key> must still hold the raw value, not a {__gen, value} envelope — a replica " +
      "running old code during a rolling deploy must be able to read it unchanged"
  );
});
