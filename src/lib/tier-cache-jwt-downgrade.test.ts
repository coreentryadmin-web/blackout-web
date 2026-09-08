// Behavioral coverage for resolveUserTier — CQ-003 / CCQ-007 JWT fast-path downgrade window.

import { before, test, mock } from "node:test";
import assert from "node:assert/strict";

class FakeTierUnavailableError extends Error {}

const clerkTier = new Map<string, string>();
let getUserCalls = 0;

mock.module("./clerk-user-cache", {
  namedExports: {
    getClerkUserCached: async (userId: string) => {
      getUserCalls += 1;
      return { publicMetadata: { tier: clerkTier.get(userId) ?? "free" } };
    },
  },
});

mock.module("./redis-pubsub", {
  namedExports: {
    redisSubscribe: async () => ({ subscribed: false }),
    redisPublish: async () => {},
  },
});

let resolveUserTier: (
  userId: string,
  sessionClaims?: Record<string, unknown> | null,
) => Promise<string>;
let invalidateTierCache: (userId: string) => void;

before(async () => {
  const mod = await import("./tier-cache.ts");
  resolveUserTier = mod.resolveUserTier;
  invalidateTierCache = mod.invalidateTierCache;
});

test("resolveUserTier: cache miss ignores stale JWT premium — reads Clerk backend (CQ-003)", async () => {
  getUserCalls = 0;
  clerkTier.set("u_downgraded", "free");
  invalidateTierCache("u_downgraded");

  const tier = await resolveUserTier("u_downgraded", { tier: "premium" });
  assert.equal(tier, "free");
  assert.ok(getUserCalls >= 1, "must consult Clerk on cache miss even when JWT says premium");
});

test("resolveUserTier: fresh cache hit avoids Clerk after publishTierChanged eviction warmed entry", async () => {
  getUserCalls = 0;
  clerkTier.set("u_cached", "community");
  invalidateTierCache("u_cached");
  await resolveUserTier("u_cached", { tier: "premium" });
  const callsAfterWarm = getUserCalls;

  const tier = await resolveUserTier("u_cached", { tier: "premium" });
  assert.equal(tier, "community");
  assert.equal(getUserCalls, callsAfterWarm, "60s cache should serve without another Clerk call");
});

test("resolveUserTier: invalidateTierCache forces backend re-read on next miss", async () => {
  getUserCalls = 0;
  clerkTier.set("u_whop", "premium");
  invalidateTierCache("u_whop");
  await resolveUserTier("u_whop", { tier: "premium" });
  const callsAfterPremium = getUserCalls;

  clerkTier.set("u_whop", "free");
  invalidateTierCache("u_whop");
  const tier = await resolveUserTier("u_whop", { tier: "premium" });
  assert.equal(tier, "free");
  assert.ok(getUserCalls > callsAfterPremium, "post-downgrade eviction must re-fetch Clerk");
});
