// Regression test for a write-then-invalidate race in resolveUserTier/invalidateTierCache,
// the same shape as clerk-user-cache.ts's own invalidationSeq fix
// (docs/audit/findings-staging/2026-10-26-clerk-user-cache-invalidate-race.md): a Whop
// downgrade webhook writes Clerk metadata then calls publishTierChanged(userId) so the next
// read sees the new tier immediately. But a resolveUserTier() call that started EARLIER —
// mid-flight reading Clerk's PRE-write state — was unaffected by the invalidation and, without
// a guard, would unconditionally re-cache its now-stale result right after the invalidation
// cleared it, resurrecting the exact staleness the invalidation was meant to prevent.

import { before, test, mock } from "node:test";
import assert from "node:assert/strict";

interface ClerkUserLike {
  publicMetadata: { tier: string };
}

function defer<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let nextFetch: { promise: Promise<ClerkUserLike> } | null = null;
let getUserCalls = 0;

mock.module("./clerk-user-cache", {
  namedExports: {
    getClerkUserCached: async (_userId: string): Promise<ClerkUserLike> => {
      getUserCalls += 1;
      if (!nextFetch) throw new Error("test must arm nextFetch before calling resolveUserTier");
      return nextFetch.promise;
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

test("resolveUserTier: an in-flight fetch that resolves AFTER invalidateTierCache does not resurrect the stale tier", async () => {
  const userId = "u_race_1";
  invalidateTierCache(userId); // clean slate
  getUserCalls = 0;

  // Arm a deferred fetch that will eventually resolve with the OLD ("premium") tier —
  // simulating a resolveUserTier call that started reading Clerk BEFORE a downgrade was
  // written and whose Clerk round-trip is still pending.
  const d = defer<ClerkUserLike>();
  nextFetch = { promise: d.promise };

  const inFlight = resolveUserTier(userId, null);

  // Let the in-flight call actually reach its `await getClerkUserCached(userId)` point
  // before the invalidation below fires.
  await new Promise((r) => setTimeout(r, 0));

  // The downgrade's write + invalidate happens WHILE the above fetch is still in flight —
  // exactly the ordering a real Whop webhook racing a concurrent page render produces.
  invalidateTierCache(userId);

  // Now the stale in-flight fetch finally resolves with the pre-downgrade ("premium") value.
  d.resolve({ publicMetadata: { tier: "premium" } });
  const firstResult = await inFlight;
  assert.equal(firstResult, "premium", "the in-flight call itself still returns what it actually read from Clerk");

  // The real question: did that now-known-stale result get written into tierCache for the
  // NEXT caller? Arm a fresh fetch returning the CURRENT ("free") tier and call again.
  const d2 = defer<ClerkUserLike>();
  d2.resolve({ publicMetadata: { tier: "free" } });
  nextFetch = { promise: d2.promise };
  const callsBeforeSecond = getUserCalls;

  const secondResult = await resolveUserTier(userId, null);

  assert.ok(
    getUserCalls > callsBeforeSecond,
    "must re-consult Clerk on the next call rather than serving a tier cached from the stale in-flight fetch",
  );
  assert.equal(secondResult, "free", "must reflect the real current tier, not the resurrected stale one");
});
