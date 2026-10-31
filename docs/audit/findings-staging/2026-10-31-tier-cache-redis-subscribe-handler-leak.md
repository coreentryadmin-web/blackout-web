# `tier-cache.ts`'s `ensureTierCacheSubscription()` leaked one `redis-pubsub` handler per call — same shape as the `flow-events.ts` fix, worse (no in-flight guard, called on every `resolveUserTier()`) — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Severity** | P2 (correctness/resource-leak, cross-replica tier-cache invalidation, not yet member-facing but unbounded and permanent). |
| **Area** | `src/lib/tier-cache.ts` (`ensureTierCacheSubscription`), consumed from `resolveUserTier()` — the shared tier gate behind both `requireTier()` (page renders) and `requireTierApi()` (market-data API routes). Root primitive: `src/lib/redis-pubsub.ts` (`redisSubscribe`, `channelHandlers`). |
| **Status** | FIXED |

### Root cause

`redis-pubsub.ts`'s `redisSubscribe(channel, handler)` registers `handler` into a module-level
`channelHandlers: Map<string, Set<(message: string) => void>>` **unconditionally**, regardless of
whether the underlying Redis connection attempt itself succeeds — by design, so a handler added
during an outage still works once the channel is ever successfully subscribed by anyone.

`tier-cache.ts`'s `ensureTierCacheSubscription()` built a **brand-new arrow-function closure** on
every call:

```ts
function ensureTierCacheSubscription(): void {
  if (tierSubReady) return;
  void import("@/lib/redis-pubsub")
    .then(async ({ redisSubscribe }) => {
      const { subscribed } = await redisSubscribe(TIER_CHANGED_CHANNEL, (userId) => {
        invalidateTierCache(userId);
      });
      if (subscribed) {
        tierSubReady = true;
      } else {
        scheduleTierCacheSubscriptionRetry();
      }
    })
    .catch(() => {
      scheduleTierCacheSubscriptionRetry();
    });
}
```

`tierSubReady` only flips `true` once a `redisSubscribe()` call has actually resolved with
`subscribed: true` — i.e. once Redis is configured AND the connection succeeds. Until then, every
call re-enters the `import(...).then(...)` branch and registers **another** closure. Unlike
`flow-events.ts`'s equivalent bug (fixed in PR #7091, same root cause), this one has **no in-flight
guard at all**: `resolveUserTier()` calls `ensureTierCacheSubscription()` unconditionally as its
very first statement, on **every single invocation — cache hit or miss** — not just on a
retry-after-failure path. So the leak isn't bounded to outage windows: any stretch where
`tierSubReady` is false (no `REDIS_URL` configured at all, or Redis simply hasn't completed its
first successful subscribe yet) means every concurrent `resolveUserTier()` call — i.e. every
concurrent page render or market-data API request hitting a tier-cache miss — registers one more
orphaned closure, forever. `resolveUserTier()` is the shared tier gate behind both `requireTier()`
(every protected page render) and `requireTierApi()` (every protected market-data API route), so
the call volume behind this is large.

Once Redis *is* reachable and the channel is ever successfully subscribed by anyone, every leaked
handler fires on every real `blackout:tier:changed` message — so a single
`publishTierChanged(userId)` call (e.g. after a Whop downgrade webhook) would invoke
`invalidateTierCache(userId)` once per leaked handler instead of once. `invalidateTierCache()` is
idempotent (it's just two `Map.delete()` calls), so this specific case doesn't corrupt tier state —
but it is pure wasted work scaling with leak count, and `getRedisPubSubStatus()` (the admin surface
built to diagnose exactly `flow-events.ts`'s equivalent incident) would give no visibility into it,
since it only reports channel *names*, not per-channel handler counts.

### Evidence

Added `src/lib/tier-cache-subscription-handler-leak.test.ts`. Deliberately avoids `mock.module()`
anywhere — round 199/200's own tooling note documents that registering `mock.module()` in a test
file breaks tsx's alias resolution (`@/lib/...`) for *unrelated* dynamic `import()` calls elsewhere
in the same test run, and `ensureTierCacheSubscription()` reaches `redis-pubsub.ts` via exactly such
a dynamic alias import — mocking anything in this file risked silently breaking that very import
(making the test pass for the wrong reason, the same trap the `flow-events.ts` PR's own write-up
flagged as the reason this file wasn't fixed at the time). Instead the test runs the **real,
unmocked** `redis-pubsub.ts` (safe because handler registration happens before any network
attempt, and this sandbox has no `REDIS_URL` configured, so `subscribed` is always `false` and
`tierSubReady` never flips `true` — exactly the "Redis unavailable" branch of the bug) and swaps
only `clerk-user-cache.ts`'s underlying fetch via its existing `__setFetchClerkUserForTest` test
hook (a plain function-reference swap, no module-mock registry involved). A new
`getChannelHandlerCount(channel)` export was added to `redis-pubsub.ts` as the probe (mirrors the
existing `getRedisPubSubStatus()` admin helper, just counting instead of naming).

The test fires a burst of 5 concurrent `resolveUserTier()` calls for 5 distinct (cache-miss)
userIds, then a second burst of 2 more, and asserts the net handler count for
`blackout:tier:changed` increases by exactly 1 across the whole run.

- **RED (pre-fix, via `git stash` on `tier-cache.ts` alone):**
  ```
  expected exactly ONE handler registered for blackout:tier:changed across the whole burst of
  concurrent resolveUserTier() calls — got a net increase of 5, implying one leaked closure
  registered per call instead of a single stable reference
  5 !== 1
  ```
- **GREEN (post-fix):** net increase of exactly 1, and the second burst adds zero more.

### Blast radius

Only one call site builds this closure (`ensureTierCacheSubscription()` itself); no other file
constructs a `TIER_CHANGED_CHANNEL` handler. The sibling `redisSubscribe` consumers
(`flow-events.ts`, `uw-rate-limiter.ts`, `polygon-rate-limiter.ts`, `provider-rate-limiter-shared.ts`,
`market-health.ts`) were already checked in round 199/#7091's write-up — `flow-events.ts` shared
this exact shape and is fixed separately in PR #7091; the others don't re-enter their
subscribe-setup path per request/connection and don't share it.

### Fix rationale

Hoisted the handler to a single stable module-level function (`handleTierChangedMessage`) instead
of a fresh closure per call — identical fix shape to `flow-events.ts`'s `handleRedisFlowMessage`.
`Set.add()` of the same reference is a no-op, so repeated calls while `tierSubReady` is false no
longer accumulate duplicates. No behavior change to the already-correct paths (first successful
subscribe, already-ready fast path, the retry-scheduling logic). Did not add an in-flight guard
(e.g. a `tierSubInFlight` boolean) on top of this — the hoisted-handler fix alone closes the actual
observable defect (duplicate invalidation fan-out), and an in-flight guard would only save
redundant `redisSubscribe()`/`client.subscribe()` calls during the brief startup window, a separate,
lower-value optimization left out to keep this fix single-issue.

### Verification

- `npx tsx --experimental-test-module-mocks --test src/lib/tier-cache-subscription-handler-leak.test.ts src/lib/tier-cache-fail-backoff.test.ts src/lib/tier-cache-freshness.test.ts src/lib/tier-cache-invalidate-race.test.ts src/lib/tier-cache-jwt-downgrade.test.ts` — all 11 GREEN
- `npx tsc --noEmit` — clean
- `npx eslint src/lib/tier-cache.ts src/lib/redis-pubsub.ts src/lib/tier-cache-subscription-handler-leak.test.ts` — clean
