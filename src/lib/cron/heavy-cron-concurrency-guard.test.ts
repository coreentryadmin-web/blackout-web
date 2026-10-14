// Regression for the cross-CRON overlap the per-cron sharedCacheSetNx locks never covered — see
// this file's companion module header for the live CloudWatch evidence (2026-10-13 RTH window,
// six different heavy crons in flight at once, 1:1 correlated with the standing ALB
// tail-latency P1).

import { test, mock } from "node:test";
import assert from "node:assert/strict";

type StoredSlot = { cronName: string; startedAt: number };
let store: Map<string, StoredSlot>;
let setNxCalls: Array<{ key: string; ttlSec: number }>;
let forceRedisError: boolean;

mock.module("../shared-cache", {
  namedExports: {
    sharedCacheSetNx: async (key: string, value: unknown, ttlSec: number): Promise<boolean> => {
      setNxCalls.push({ key, ttlSec });
      if (forceRedisError) throw new Error("simulated Redis error");
      if (store.has(key)) return false;
      store.set(key, value as StoredSlot);
      return true;
    },
    sharedCacheDel: async (key: string): Promise<void> => {
      store.delete(key);
    },
  },
});

test("acquires slot 1 when every slot is free", async () => {
  store = new Map();
  setNxCalls = [];
  forceRedisError = false;
  const { acquireHeavyCronSlot } = await import("./heavy-cron-concurrency-guard");

  const slot = await acquireHeavyCronSlot("vector-pick-sweep", 900);
  assert.ok(slot, "must acquire a slot when none are held");
  assert.equal(slot!.cronName, "vector-pick-sweep");
  assert.equal(setNxCalls.length, 1, "must claim the FIRST slot before trying a second");
  assert.equal(setNxCalls[0]!.key, "cron:heavy-slot:1");
  assert.equal(setNxCalls[0]!.ttlSec, 900, "TTL must be the caller's own overlap-lock TTL, not a hardcoded value");
});

test("a second concurrent cron falls through to slot 2 when slot 1 is held", async () => {
  store = new Map();
  setNxCalls = [];
  forceRedisError = false;
  const { acquireHeavyCronSlot } = await import("./heavy-cron-concurrency-guard");

  const first = await acquireHeavyCronSlot("vector-pick-sweep", 900);
  assert.ok(first);
  const second = await acquireHeavyCronSlot("zerodte-warm", 900);
  assert.ok(second, "a second, different cron must still get a slot");
  assert.equal(second!.cronName, "zerodte-warm");
  assert.equal(store.get("cron:heavy-slot:2")?.cronName, "zerodte-warm");
});

test("a third concurrent cron is refused — the whole point of the cap — null means caller must skip", async () => {
  store = new Map();
  setNxCalls = [];
  forceRedisError = false;
  const { acquireHeavyCronSlot, MAX_CONCURRENT_HEAVY_CRONS } = await import("./heavy-cron-concurrency-guard");

  assert.equal(MAX_CONCURRENT_HEAVY_CRONS, 2, "cap documented in this test must match the module's real cap");
  await acquireHeavyCronSlot("vector-pick-sweep", 900);
  await acquireHeavyCronSlot("zerodte-warm", 900);
  const third = await acquireHeavyCronSlot("vector-dark-pool-warm", 900);
  assert.equal(third, null, "every slot held -> null, never a third concurrent heavy cron");
});

test("releasing a slot frees it for the next caller", async () => {
  store = new Map();
  setNxCalls = [];
  forceRedisError = false;
  const { acquireHeavyCronSlot } = await import("./heavy-cron-concurrency-guard");

  const first = await acquireHeavyCronSlot("vector-pick-sweep", 900);
  assert.ok(first);
  await first!.release();
  assert.equal(store.has("cron:heavy-slot:1"), false, "release must actually clear the slot key");

  const second = await acquireHeavyCronSlot("bie-full-state-snapshot", 900);
  assert.ok(second, "a freed slot must be claimable again");
  assert.equal(store.get("cron:heavy-slot:1")?.cronName, "bie-full-state-snapshot");
});

test("release() is idempotent — calling it twice does not throw or double-free someone else's slot", async () => {
  store = new Map();
  setNxCalls = [];
  forceRedisError = false;
  const { acquireHeavyCronSlot } = await import("./heavy-cron-concurrency-guard");

  const first = await acquireHeavyCronSlot("vector-pick-sweep", 900);
  await first!.release();
  // A different cron now legitimately holds slot 1 — a stale double-release must not evict it.
  const second = await acquireHeavyCronSlot("zerodte-warm", 900);
  await first!.release();
  assert.equal(store.get("cron:heavy-slot:1")?.cronName, "zerodte-warm", "double release must not clobber a later holder");
  assert.ok(second);
});

test("fails OPEN on a Redis error — a missed concurrency guard is safer than a stuck cron, matching every sibling overlap lock", async () => {
  store = new Map();
  setNxCalls = [];
  forceRedisError = true;
  const { acquireHeavyCronSlot } = await import("./heavy-cron-concurrency-guard");

  const slot = await acquireHeavyCronSlot("vector-pick-sweep", 900);
  assert.ok(slot, "a Redis error acquiring the guard must not block the cron from running at all");
});
