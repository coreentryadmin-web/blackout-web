import { before, test, mock } from "node:test";
import assert from "node:assert/strict";

// sharedCacheSetNx is the cross-replica idempotency primitive behind the swing-discovery cron's
// (date, phase) claim. The bug it fixes is a read-then-write RACE: the old guard did sharedCacheGet
// then sharedCacheSet, so two replicas firing the same cron minute could BOTH read "absent" and BOTH
// run. This suite proves the NX claim is atomic — first SET NX wins, a concurrent SET NX is refused.
//
// We mock ./make-redis so getRedis() returns a FAKE ioredis client whose `set(...,"NX")` honours the
// real Redis semantics: it creates the key and returns "OK" only when the key is absent, else null.
// Run with: node --import tsx --test --experimental-test-module-mocks src/lib/shared-cache.test.ts

/** A minimal ioredis stand-in with real NX semantics on set(). Only the methods shared-cache calls. */
function makeFakeRedis() {
  const store = new Map<string, string>();
  const calls: string[][] = [];
  return {
    store,
    calls,
    client: {
      async get(key: string): Promise<string | null> {
        return store.has(key) ? store.get(key)! : null;
      },
      async set(key: string, value: string, ...args: (string | number)[]): Promise<unknown> {
        calls.push([key, value, ...args.map(String)]);
        const nx = args.some((a) => String(a).toUpperCase() === "NX");
        // NX: only create when absent — this is the atomic branch the race depends on.
        if (nx && store.has(key)) return null;
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

// Make getRedis() succeed with our fake by mocking the makeRedis factory it dynamically imports.
mock.module("./make-redis", {
  namedExports: {
    makeRedis: async () => fake.client,
  },
});

let sharedCacheSetNx: typeof import("./shared-cache").sharedCacheSetNx;

before(async () => {
  // getRedis() gates on REDIS_URL — set it so the Redis (atomic) path is exercised, not the fallback.
  process.env.REDIS_URL = "redis://fake:6379";
  ({ sharedCacheSetNx } = await import("./shared-cache"));
});

test("two concurrent claims on the same (date, phase) → exactly one acquires", async () => {
  const key = `swing:discovery:2026-07-24:POST_CLOSE:${Math.random()}`;

  // Fire both claims concurrently — the class of bug is precisely two replicas racing the same key.
  const [a, b] = await Promise.all([
    sharedCacheSetNx(key, Date.now(), 60),
    sharedCacheSetNx(key, Date.now(), 60),
  ]);

  const winners = [a, b].filter(Boolean).length;
  assert.equal(winners, 1, "exactly one concurrent claim must win");
  assert.notEqual(a, b, "the two claims must return opposite results (one acquired, one refused)");
});

test("a later claim on an already-held key is refused (idempotent skip)", async () => {
  const key = `swing:discovery:2026-07-24:MIDDAY:${Math.random()}`;

  const first = await sharedCacheSetNx(key, 1, 60);
  const second = await sharedCacheSetNx(key, 2, 60);

  assert.equal(first, true, "the first claim acquires");
  assert.equal(second, false, "a second claim on the same key is refused");
});

test("the atomic branch issues a real SET ... NX (not a get-then-set)", async () => {
  const key = `swing:discovery:2026-07-24:PRE_OPEN:${Math.random()}`;
  const before = fake.calls.length;

  await sharedCacheSetNx(key, 1, 60);

  const issued = fake.calls.slice(before).find((c) => c[0] === `blackout:${key}`);
  assert.ok(issued, "a SET was issued for the namespaced key");
  assert.ok(
    issued!.some((a) => a.toUpperCase() === "NX"),
    "the claim must use NX so the set-if-absent is atomic in Redis, not a racy read-then-write",
  );
});
