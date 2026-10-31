// Regression test for a redisSubscribe() handler leak in tier-cache.ts's
// ensureTierCacheSubscription(), the same shape fixed in flow-events.ts's ensureRedisBridge()
// (see src/lib/flow-events.test.ts and docs/audit/findings-staging/
// 2026-10-31-flow-events-redis-subscribe-handler-leak.md).
//
// redis-pubsub.ts's redisSubscribe(channel, handler) registers `handler` into a module-level
// `channelHandlers: Map<string, Set<(message: string) => void>>` UNCONDITIONALLY, regardless of
// whether the underlying Redis connection attempt itself succeeds (by design — a handler added
// during an outage still works once the channel is ever successfully subscribed by anyone).
//
// resolveUserTier() calls ensureTierCacheSubscription() on EVERY invocation (cache hit or miss,
// no in-flight guard) before awaiting anything. Pre-fix, ensureTierCacheSubscription() built a
// brand-new arrow-function closure on every call and handed it to redisSubscribe() — so while
// tierSubReady stays false (which it does for as long as no successful subscribe has happened,
// e.g. no REDIS_URL configured, exactly this sandbox's default), a burst of concurrent
// resolveUserTier() calls (many requests racing in before any of them completes) each registers
// its OWN closure, leaking one more handler per call forever.
//
// Deliberately does NOT use mock.module() anywhere in this file: round 199/200's own tooling
// note documents that registering mock.module() in a test file breaks tsx's alias resolution
// (`@/lib/...`) for UNRELATED dynamic import() calls made elsewhere in the same test run — and
// tier-cache.ts's ensureTierCacheSubscription() reaches redis-pubsub.ts via exactly such a
// dynamic alias import. Mocking it (or anything else) in this file risks silently breaking that
// very import, which would make the test pass for the wrong reason (the import throwing and
// being swallowed by ensureTierCacheSubscription()'s own .catch(), never even reaching
// redisSubscribe()). Instead this test runs the REAL, unmocked redis-pubsub.ts (safe because
// handler registration happens before any network attempt) and swaps only
// clerk-user-cache.ts's Clerk fetch via its existing __setFetchClerkUserForTest test hook, which
// is a plain exported function reference — no module mock registry involved at all.

import { before, test } from "node:test";
import assert from "node:assert/strict";
import { __setFetchClerkUserForTest } from "./clerk-user-cache.ts";
import { getChannelHandlerCount } from "./redis-pubsub.ts";

// Mirrors tier-cache.ts's own (unexported) TIER_CHANGED_CHANNEL constant.
const TIER_CHANGED_CHANNEL = "blackout:tier:changed";

let resolveUserTier: typeof import("./tier-cache.ts").resolveUserTier;

before(async () => {
  ({ resolveUserTier } = await import("./tier-cache.ts"));
});

test("tier-cache: a burst of concurrent resolveUserTier cache misses registers ONE redis-pubsub handler, not one per call", async () => {
  // Resolve fast with a dummy tier so resolveUserTier's own Clerk round-trip never blocks the
  // test — the point under test is the SYNCHRONOUS ensureTierCacheSubscription() call at the top
  // of resolveUserTier, which fires before this fetch is ever awaited.
  __setFetchClerkUserForTest(async () => ({ publicMetadata: { tier: "free" } }) as never);

  const before_ = getChannelHandlerCount(TIER_CHANGED_CHANNEL);

  // Five distinct userIds (all cache misses) "racing in" together — e.g. five concurrent
  // page renders / API requests for different users, none of which has yet seen
  // ensureTierCacheSubscription() flip tierSubReady to true (it never does here, since this
  // sandbox has no REDIS_URL configured and every subscribe attempt reports subscribed:false).
  await Promise.all([
    resolveUserTier("u_leak_test_1", null),
    resolveUserTier("u_leak_test_2", null),
    resolveUserTier("u_leak_test_3", null),
    resolveUserTier("u_leak_test_4", null),
    resolveUserTier("u_leak_test_5", null),
  ]);

  // Give the fire-and-forget `import("@/lib/redis-pubsub").then(...)` chains inside every
  // ensureTierCacheSubscription() call a tick to actually reach redisSubscribe() and register
  // into channelHandlers — that registration happens unconditionally, even though there's no
  // REDIS_URL and the connection attempt itself never succeeds.
  await new Promise((r) => setTimeout(r, 50));

  const after_ = getChannelHandlerCount(TIER_CHANGED_CHANNEL);
  assert.equal(
    after_ - before_,
    1,
    `expected exactly ONE handler registered for ${TIER_CHANGED_CHANNEL} across the whole burst ` +
      `of concurrent resolveUserTier() calls — got a net increase of ${after_ - before_}, ` +
      `implying one leaked closure registered per call instead of a single stable reference`
  );

  // A SECOND, later burst (simulating more requests arriving after the first one, still with
  // tierSubReady never having flipped true) must not add any more handlers either — the fix is
  // a stable reference, not a one-time coincidence of this particular burst's timing.
  await Promise.all([
    resolveUserTier("u_leak_test_6", null),
    resolveUserTier("u_leak_test_7", null),
  ]);
  await new Promise((r) => setTimeout(r, 50));

  const afterSecondBurst = getChannelHandlerCount(TIER_CHANGED_CHANNEL);
  assert.equal(
    afterSecondBurst,
    after_,
    `a second burst of resolveUserTier() calls must not register any additional handlers — ` +
      `went from ${after_} to ${afterSecondBurst}`
  );
});
