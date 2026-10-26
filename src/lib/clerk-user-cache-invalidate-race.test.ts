import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getClerkUserCached,
  invalidateClerkUserCache,
  __setFetchClerkUserForTest,
} from "./clerk-user-cache.ts";

// Simulates the real-world race between:
//   1. An ordinary request calling getClerkUserCached(userId) — which kicks off a Clerk
//      getUser(userId) fetch that reads Clerk's CURRENT (soon to be stale) state and takes a
//      little while to resolve, and
//   2. An admin write (setToolAccessForUserId / any Clerk metadata write) that completes
//      strictly AFTER (1) started but BEFORE (1)'s fetch resolves, and then calls
//      invalidateClerkUserCache(userId) to make sure the next read sees the new data.
//
// The bug: invalidateClerkUserCache only clears what is currently IN the cache. It cannot
// stop an already-in-flight fetch (started before the write) from completing afterward and
// writing its now-stale result into `resolved` via setResolved — silently resurrecting the
// exact staleness the invalidate call was made to clear, for up to another DEDUPE_TTL_MS
// (5s in production).
//
// Mocking the real Clerk SDK here would need to intercept the bare "@clerk/nextjs/server"
// specifier from INSIDE clerk-user-cache.ts's own dynamic import. That does not work under
// this harness: node:test's --experimental-test-module-mocks module mocking is not observed
// by a dynamic `import(bareSpecifier)` call issued from a tsx-CJS-transpiled .ts module (every
// .ts file here), only from an untransformed .mjs/.js ESM module — confirmed empirically by
// swapping the intermediary file's extension and nothing else. clerk-user-cache.ts therefore
// exposes a narrow `__setFetchClerkUserForTest` seam (same "*ForTest" convention as
// resetPolygonCircuitForTest / _resetZeroDteLiveMarksForTest elsewhere in this repo) so this
// test can control fetch timing directly instead.

test("clerk-user-cache: a write-then-invalidate does not get resurrected by an in-flight fetch that started before it", async () => {
  const userId = "user_race_test_1";
  let getUserCallCount = 0;
  let pendingResolvers: Array<(value: { publicMetadata: { tool_access?: unknown } }) => void> = [];

  __setFetchClerkUserForTest((_id: string) => {
    getUserCallCount++;
    // Never resolves until the test explicitly flushes it — this is what lets the test land
    // an invalidate() WHILE this fetch is still in flight.
    return new Promise((resolve) => {
      pendingResolvers.push(resolve as (value: unknown) => void);
    }) as Promise<{ publicMetadata: { tool_access?: unknown } }>;
  });

  invalidateClerkUserCache(); // start from a clean slate regardless of test order

  // (1) An ordinary request starts reading — this fetch will resolve to the OLD value.
  const staleRead = getClerkUserCached(userId);
  assert.equal(getUserCallCount, 1, "first call should hit Clerk (no cache yet)");

  // (2) Concurrently, an admin write lands and calls invalidate — exactly the
  // setToolAccessForUserId pattern (write, then invalidateClerkUserCache(userId)) — while
  // (1)'s fetch is still pending.
  invalidateClerkUserCache(userId);

  // Now let (1)'s fetch resolve with the OLD (pre-write) data.
  assert.equal(pendingResolvers.length, 1, "the in-flight fetch must still be pending at invalidate time");
  pendingResolvers[0]({ publicMetadata: { tool_access: { vector: "grant" /* STALE */ } } });
  const stale = (await staleRead) as { publicMetadata: { tool_access?: unknown } };
  assert.deepEqual(stale.publicMetadata.tool_access, { vector: "grant" });

  // (3) A fresh read right after must NOT be served the stale value the in-flight fetch
  // just (mis)wrote into the cache after the invalidate — it must go back to Clerk and
  // observe the real post-write value.
  const freshRead = getClerkUserCached(userId);
  assert.equal(
    getUserCallCount,
    2,
    "a read after the invalidate must issue a fresh Clerk call, not reuse the value the " +
      "stale in-flight fetch wrote into the cache after invalidation"
  );
  assert.equal(pendingResolvers.length, 2);
  pendingResolvers[1]({ publicMetadata: { tool_access: { vector: "block" /* NEW, real */ } } });
  const fresh = (await freshRead) as { publicMetadata: { tool_access?: unknown } };
  assert.deepEqual(fresh.publicMetadata.tool_access, { vector: "block" });
});

test("clerk-user-cache: a global invalidate() (no userId) also suppresses an in-flight stale write", async () => {
  const userId = "user_race_test_2";
  let getUserCallCount = 0;
  let pendingResolvers: Array<(value: { publicMetadata: { tool_access?: unknown } }) => void> = [];

  __setFetchClerkUserForTest((_id: string) => {
    getUserCallCount++;
    return new Promise((resolve) => {
      pendingResolvers.push(resolve as (value: unknown) => void);
    }) as Promise<{ publicMetadata: { tool_access?: unknown } }>;
  });

  invalidateClerkUserCache();

  const staleRead = getClerkUserCached(userId);
  assert.equal(getUserCallCount, 1);

  invalidateClerkUserCache(); // global form, same as the per-user form above

  pendingResolvers[0]({ publicMetadata: { tool_access: { vector: "grant" } } });
  await staleRead;

  const freshRead = getClerkUserCached(userId);
  assert.equal(getUserCallCount, 2, "global invalidate must also prevent the stale in-flight write from sticking");
  pendingResolvers[1]({ publicMetadata: { tool_access: { vector: "block" } } });
  const fresh = (await freshRead) as { publicMetadata: { tool_access?: unknown } };
  assert.deepEqual(fresh.publicMetadata.tool_access, { vector: "block" });
});

test("clerk-user-cache: sanity — without any invalidate, the in-flight fetch's result IS cached (dedupe still works)", async () => {
  const userId = "user_race_test_3";
  let getUserCallCount = 0;
  let pendingResolvers: Array<(value: { publicMetadata: { tool_access?: unknown } }) => void> = [];

  __setFetchClerkUserForTest((_id: string) => {
    getUserCallCount++;
    return new Promise((resolve) => {
      pendingResolvers.push(resolve as (value: unknown) => void);
    }) as Promise<{ publicMetadata: { tool_access?: unknown } }>;
  });

  invalidateClerkUserCache();

  const read1 = getClerkUserCached(userId);
  pendingResolvers[0]({ publicMetadata: { tool_access: { vector: "grant" } } });
  await read1;

  const read2 = getClerkUserCached(userId);
  assert.equal(getUserCallCount, 1, "no invalidate happened — the resolved cache should serve the second read");
  const result2 = (await read2) as { publicMetadata: { tool_access?: unknown } };
  assert.deepEqual(result2.publicMetadata.tool_access, { vector: "grant" });
});
