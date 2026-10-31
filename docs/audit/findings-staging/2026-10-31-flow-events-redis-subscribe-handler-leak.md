> **kind:** FINDING

## flow-events.ts: a retried `redisSubscribe` registration leaks one handler per attempt, amplifying flow-event delivery after recovery — FIXED

| | |
|---|---|
| **Area** | `src/lib/flow-events.ts` (cross-instance flow fan-out bridge, consumed by `/api/market/flows/stream` SSE + `init-data-sockets.ts`) |
| **Severity** | P2 — latent memory leak that, once Redis recovers from any outage, causes every member's `/api/market/flows/stream` SSE connection to receive duplicate (multiplied) flow events |
| **Status** | FIXED |

### Root cause

`redis-pubsub.ts`'s `redisSubscribe(channel, handler)` registers `handler` into a module-level
`channelHandlers: Map<string, Set<(message: string) => void>>` **unconditionally**, regardless of
whether the underlying Redis connection attempt actually succeeds:

```ts
export async function redisSubscribe(channel, handler) {
  if (!channelHandlers.has(channel)) channelHandlers.set(channel, new Set());
  channelHandlers.get(channel)!.add(handler);   // <-- always runs

  let subscribed = false;
  const client = await connectSubscriber();
  if (client) { try { await client.subscribe(channel); subscribed = true; } catch { /* local-only */ } }
  // ... returns { unsubscribe, subscribed }
}
```

This is a deliberate design choice *in isolation*: if a different, later `redisSubscribe` call for
the SAME channel succeeds in actually issuing `SUBSCRIBE` on the live client, every handler already
sitting in that channel's `Set` — including ones added during earlier failed attempts — starts
receiving messages too, without needing to re-register. The contract only works correctly, though,
if a caller that gets back `subscribed: false` either (a) calls the returned `unsubscribe()` before
giving up, or (b) retries later with the **same handler reference**, so `Set.add()` of an
already-present function is a no-op.

`flow-events.ts`'s `ensureRedisBridge()` did neither. On every failed attempt it reset
`bridgeInit = null` so the *next* caller would retry — but every caller of this module
(`init-data-sockets.ts` at process boot, and **every new `/api/market/flows/stream` SSE
connection**, via `initFlowEventBridge()`/`subscribeFlowEvents()`) re-entered `ensureRedisBridge()`,
which built a **brand-new arrow-function closure** and handed it to `redisSubscribe` again:

```ts
bridgeInit = (async () => {
  const { unsubscribe, subscribed } = await redisSubscribe(FLOW_REDIS_CHANNEL, (message) => {
    const flow = decodeFlowMessage(message, INSTANCE_ID);
    if (flow) { receivedViaRedis += 1; fanOutLocal(flow); }
  });
  redisUnsubscribe = unsubscribe;        // overwrites the PREVIOUS attempt's unsubscribe,
  bridgeReady = subscribed;              // which is never called — that closure is orphaned
  if (!subscribed) bridgeInit = null;    // forever inside channelHandlers' Set.
})();
```

Neither the discarded `unsubscribe` from the failed attempt nor the stable-identity trick was used,
so every failed-then-retried attempt left one more closure permanently registered in
`channelHandlers.get("blackout:flow-events")`.

### Evidence

Added `src/lib/flow-events.test.ts`, which fakes `redis-pubsub.ts`'s own `channelHandlers` Set
behavior (handler added on every call regardless of outcome — exactly mirroring the real module)
and drives `initFlowEventBridge()` through two failed attempts followed by a third, successful one
(simulating a transient Redis outage that clears up), then delivers exactly ONE Redis message.

- **RED (pre-fix, proven via `git stash` on `flow-events.ts` alone):** a single simulated
  cross-instance Redis message fanned out to a local SSE listener **3 times** — once per leaked
  closure from the 3 total `redisSubscribe` attempts — and `getFlowEventsBridgeStatus().received_via_redis`
  likewise over-counted:
  ```
  a single cross-instance flow message must fan out to each local listener exactly once
  — got 3, implying 3 leaked duplicate handler(s) registered across the 3 retry attempts instead of 1
  AssertionError [ERR_ASSERTION]: 3 !== 1
  ```
- **GREEN (post-fix):** same test passes — exactly 1 delivery per message, regardless of how many
  failed attempts preceded the successful one.

Real-world blast radius of the pre-fix bug: during any Redis outage (even a brief one — ECS rolling
deploy, ElastiCache failover, network blip), every member's SSE reconnect to
`/api/market/flows/stream` (and the `init-data-sockets.ts` boot-time call) adds one more permanently
leaked handler. Once Redis recovers, **every subsequent cross-instance flow event is delivered once
per leaked handler** to every local SSE listener on that replica — members would see the same flow
print duplicated an unbounded, outage-duration-dependent number of times, and `received_via_redis`
in `getFlowEventsBridgeStatus()` (the admin health surface) would silently over-report real
throughput, masking the true picture during exactly the kind of incident an admin would want to
diagnose.

### Blast radius

- `src/lib/tier-cache.ts`'s `ensureTierCacheSubscription()` has the **identical root-cause shape**:
  it also builds a fresh arrow-function closure on every call to `redisSubscribe(TIER_CHANGED_CHANNEL,
  ...)`, and (unlike `flow-events.ts`) has **no in-flight promise guard at all** — `resolveUserTier()`
  calls it synchronously on every cache-miss request (every protected page render / API auth check,
  per that file's own header comment), so a burst of concurrent requests before the first subscribe
  settles fires one `redisSubscribe` call *per request*, not just per retry. This is very likely a
  real, currently-live instance of the same leak, probably with a larger leak rate than this one.
  **Not fixed in this PR**: this repo's `mock.module()` + tsx's dynamic-import alias resolution for
  `@/lib/*` specifiers interact badly in this sandbox (confirmed empirically — a `mock.module` call
  registered for ANY specifier in a test file silently breaks alias resolution for *unrelated*
  dynamic `import("@/lib/...")` calls made from an already-loaded module, which fails ending up
  swallowed by `tier-cache.ts`'s own `.catch()`, making the existing `tier-cache-*.test.ts` files
  pass today regardless of whether their `redisSubscribe` mock is even reached). Without a reliable
  way to write a RED→GREEN regression test for it in this environment, per this repo's issue-handling
  policy it is being left as a flagged, high-confidence follow-up rather than shipped unverified.
  **Recommended next step**: apply the same "hoist the handler to one stable module-level function
  reference" fix used here to `tier-cache.ts`'s `handleTierChangedMessage`, and find a test strategy
  that doesn't depend on intercepting the dynamic alias import (e.g. a small test-only export from
  `redis-pubsub.ts` exposing `channelHandlers` size for a channel, so the real module — unmocked —
  can be exercised directly with `REDIS_URL` unset).
- Other consumers of `redisSubscribe` (`uw-rate-limiter.ts`, `polygon-rate-limiter.ts`,
  `provider-rate-limiter-shared.ts`, `market-health.ts`) were checked: none of them re-enter their
  subscribe-setup path on a per-request basis the way `flow-events.ts`/`tier-cache.ts` do, so they
  do not share this specific leak shape.

### Fix rationale

Hoisted the handler to a single stable module-level function (`handleRedisFlowMessage`) instead of
building a new arrow function per attempt. Because `channelHandlers`'s per-channel value is a `Set`,
re-adding the same function reference on every retry is a no-op — the leak is eliminated at the
root without touching `redis-pubsub.ts`'s public contract (which other future callers may still
rely on for the "a handler added during an outage still works once the channel is ever
successfully subscribed by anyone" behavior). This is the minimal change: no behavior changes for
the already-correct cases (first successful subscribe, already-ready fast path), and the bridge's
retry cadence/logic is untouched — only the identity of what gets registered each attempt changed.

Deliberately left unchanged: `redis-pubsub.ts` itself (the unconditional-add contract is useful when
honored correctly by callers, per the design rationale above) and `tier-cache.ts` (same root cause,
flagged above as a follow-up pending a workable test strategy in this sandbox).
