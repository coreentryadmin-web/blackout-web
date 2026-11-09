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
  // Per-key TTL override for sharedCacheRawTtlSec's own tests below — the pre-existing NX tests
  // never read this (they only care that set()/get()/del() behave), so defaulting unset keys to
  // 100 keeps their fixed expectation unchanged.
  const ttlByKey = new Map<string, number>();
  return {
    store,
    calls,
    ttlByKey,
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
      async ttl(key: string): Promise<number> {
        return ttlByKey.has(key) ? ttlByKey.get(key)! : 100;
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
let sharedCacheRawTtlSec: typeof import("./shared-cache").sharedCacheRawTtlSec;

before(async () => {
  // getRedis() gates on REDIS_URL — set it so the Redis (atomic) path is exercised, not the fallback.
  process.env.REDIS_URL = "redis://fake:6379";
  ({ sharedCacheSetNx, sharedCacheRawTtlSec } = await import("./shared-cache"));
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

test("Redis SET NX errors propagate (no in-memory false acquire) — regression guard", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("./shared-cache.ts", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export async function sharedCacheSetNx"));
  const body = fn.slice(0, fn.indexOf("export async function sharedCacheDel"));
  assert.doesNotMatch(
    body,
    /catch\s*\{[\s\S]*fall through to the in-memory claim/,
    "must not fall through to in-memory NX on Redis error — callers use .catch for fail-open",
  );
  assert.doesNotMatch(body, /if \(redis\)[\s\S]*try\s*\{[\s\S]*set\([\s\S]*catch/);
});

// ───────────────────────────────────────────────────────────────────────────
// sharedCacheRawTtlSec — the literal Redis TTL probe added 2026-11-09 so a caller (specifically
// data-integrity-verifier.ts's redis_ttl check) can tell a key with NO expiry (-1) apart from a
// key that's genuinely ABSENT (-2), a distinction sharedCacheGetWithTtl cannot make: it filters
// every result through `raw && ttl > 0`, so -1 and -2 both come back as a plain `null` there.
// ───────────────────────────────────────────────────────────────────────────

test("sharedCacheRawTtlSec: hands back a bounded positive TTL verbatim", async () => {
  const key = `probe:bounded:${Math.random()}`;
  fake.ttlByKey.set(`blackout:${key}`, 42);
  assert.equal(await sharedCacheRawTtlSec(key), 42);
});

// This is the exact regression this function exists to let callers observe — a Redis key present
// with no expiry set must surface as the literal -1, not get swallowed into "nothing found".
test("sharedCacheRawTtlSec: a key with NO expiry (-1) is returned as -1, not swallowed into null", async () => {
  const key = `probe:no-expiry:${Math.random()}`;
  fake.ttlByKey.set(`blackout:${key}`, -1);
  assert.equal(await sharedCacheRawTtlSec(key), -1);
});

test("sharedCacheRawTtlSec: a genuinely absent key is returned as -2", async () => {
  const key = `probe:absent:${Math.random()}`;
  fake.ttlByKey.set(`blackout:${key}`, -2);
  assert.equal(await sharedCacheRawTtlSec(key), -2);
});

test("sharedCacheRawTtlSec: -1 (no expiry) and -2 (absent) are DISTINGUISHABLE — the gap sharedCacheGetWithTtl cannot close", async () => {
  const noExpiryKey = `probe:cmp-no-expiry:${Math.random()}`;
  const absentKey = `probe:cmp-absent:${Math.random()}`;
  fake.ttlByKey.set(`blackout:${noExpiryKey}`, -1);
  fake.ttlByKey.set(`blackout:${absentKey}`, -2);
  const [noExpiry, absent] = await Promise.all([
    sharedCacheRawTtlSec(noExpiryKey),
    sharedCacheRawTtlSec(absentKey),
  ]);
  assert.notEqual(noExpiry, absent, "a no-expiry key and an absent key must read as different states");
  assert.equal(noExpiry, -1);
  assert.equal(absent, -2);
});
