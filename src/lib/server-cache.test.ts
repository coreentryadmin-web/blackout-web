import { test } from "node:test";
import assert from "node:assert/strict";
import { serverCache, isDegraded } from "./server-cache";

// Covers the load-bearing guarantee behind null-commentary-cache: when the loader
// THROWS, serverCache stores nothing and clears the in-flight entry, so the next
// request rebuilds immediately (no negative caching). server-cache.ts is alias-free
// (its only import is a dynamic import("./shared-cache") gated on process.env.REDIS_URL),
// so leaving REDIS_URL unset keeps readRedisCache/writeRedisCache as no-ops and this
// runs under `npx tsx --test` without Next or Redis. Each test uses a unique key
// because store/failureCount/inflight are module-level Maps.

const TTL = 60_000;

test("loader that throws stores nothing and the next call rebuilds", async () => {
  const key = `test:throw-then-resolve:${Math.random()}`;
  await assert.rejects(
    serverCache(key, TTL, async () => {
      throw new Error("spx-commentary: generation returned null");
    })
  );
  // Nothing was cached and inflight was cleared, so this loader MUST run.
  let invoked = 0;
  const value = await serverCache(key, TTL, async () => {
    invoked += 1;
    return { ok: true };
  });
  assert.equal(invoked, 1);
  assert.deepEqual(value, { ok: true });
});

test("resolved value is cached: second call within ttl does not re-invoke loader", async () => {
  const key = `test:resolve-dedup:${Math.random()}`;
  let invoked = 0;
  const first = await serverCache(key, TTL, async () => {
    invoked += 1;
    return { n: 1 };
  });
  const second = await serverCache(key, TTL, async () => {
    invoked += 1;
    return { n: 2 };
  });
  assert.equal(invoked, 1);
  assert.deepEqual(first, { n: 1 });
  assert.deepEqual(second, { n: 1 });
});

test("repeated throws mark the key degraded after the failure threshold", async () => {
  const key = `test:degrade:${Math.random()}`;
  const thrower = async () => {
    throw new Error("spx-commentary: generation returned null");
  };
  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(serverCache(key, TTL, thrower));
  }
  assert.equal(isDegraded(key), true);
});
