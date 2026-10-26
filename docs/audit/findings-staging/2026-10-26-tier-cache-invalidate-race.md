> **kind:** FINDING

## `src/lib/tier-cache.ts` — `invalidateTierCache`/`publishTierChanged` don't guard an in-flight `resolveUserTier` fetch — FIXED

| | |
|---|---|
| **Status** | Fixed |
| **File** | `src/lib/tier-cache.ts` |
| **Severity** | P2 — can re-grant a stale (including downgraded) tier for up to the full 60s TTL after an explicit, supposedly-instant invalidation |
| **Found** | 2026-10-26, round 120 discovery sweep — a sibling-check follow-up explicitly flagged by round 118/119 (the `clerk-user-cache.ts` write-then-invalidate race, PR #6918): "check whether any OTHER cache in the codebase has the same shape." |

### Root cause

`resolveUserTier()` is a classic cache-miss-then-fetch-then-cache function:

```js
const user = await getClerkUserCached(userId);
const tier = parseTier(user.publicMetadata?.tier);
setTierCache(userId, tier);
```

`invalidateTierCache(userId)` (and `publishTierChanged`, which calls it) is documented as giving
"immediate cross-replica invalidation" after a confirmed Whop/Clerk metadata write — e.g. a
subscription downgrade webhook writes the new tier to Clerk then calls `publishTierChanged(userId)`
so every replica's next read sees `free` right away instead of waiting out the 60s TTL.

But `invalidateTierCache` can only clear what is **already sitting in `tierCache`** — it has no way
to reach a `resolveUserTier()` call that started **earlier** (and is therefore mid-flight, reading
Clerk's **pre-write** state) and stop it from completing afterward. Without a guard, that in-flight
call's `setTierCache(userId, tier)` runs unconditionally once its Clerk round-trip resolves,
re-caching the exact pre-downgrade tier — e.g. `premium` — right after the invalidation that was
supposed to make the downgrade visible instantly. The next TTL_MS (60s) of requests on that replica
then see the stale, already-downgraded-away tier, directly contradicting the "instant" guarantee
`publishTierChanged`'s own doc comment promises.

This is the identical shape to the `getClerkUserCached`/`invalidateClerkUserCache` race PR #6918
fixed one layer down — `tier-cache.ts` builds its own, separate cache (`tierCache`) *on top of*
`clerk-user-cache.ts`'s cache, with its own independent invalidation path, so fixing the lower layer
did not fix this one; the two caches needed the same fix independently.

### Evidence

New test file `src/lib/tier-cache-invalidate-race.test.ts`, mocking `getClerkUserCached` with a
manually-controlled deferred promise to reproduce the exact interleaving:

1. Call `resolveUserTier(userId)` — it reaches its `await getClerkUserCached(userId)` and is left
   pending (the mock fetch has not resolved yet).
2. While still pending, call `invalidateTierCache(userId)` — simulating the downgrade webhook's
   write-then-invalidate landing concurrently.
3. Resolve the pending mock fetch with the OLD (`premium`) tier. The first call completes and
   correctly returns `premium` to its own caller (it can't un-ask a question it already asked).
4. Call `resolveUserTier(userId)` again, with a fresh mock armed to return the CURRENT (`free`)
   tier.

**RED** (fix stashed out, `git stash -- src/lib/tier-cache.ts`): step 4 reads directly from a
cache entry the stale step-3 fetch wrote, serves `premium` without ever calling Clerk again, and
the assertion fails: `must re-consult Clerk on the next call rather than serving a tier cached from
the stale in-flight fetch`.

**GREEN** (fix restored): step 4 correctly re-consults Clerk (`getUserCalls` increases) and returns
`free`.

Full affected-suite rerun, all green (65/65): the new test plus every existing `tier-cache*`,
`auth-access-tier-gate`, `market-api-auth-tier-gate`, `sse-stream-entitlement*`,
`membership-reconcile-downgrade`, `gated-route-redirects`, `admin-user-access`, `auth-server`, and
the Whop/Clerk/membership webhook route tests that exercise `resolveUserTier`/`publishTierChanged`
indirectly. `npx tsc --noEmit` and `npx eslint src/lib/tier-cache.ts
src/lib/tier-cache-invalidate-race.test.ts` both clean.

### Blast radius

`resolveUserTier()` is the single read path shared by `requireTier()` (page gate) and
`requireTierApi()` (market-data API gate) — every tier-gated page render and every protected API
call goes through this one cache. `invalidateTierCache`/`publishTierChanged` are called from the
Whop webhook route, the Clerk webhook route, the admin user-sync route, and the membership-sync
route — any of these racing a concurrent page render/API call on the same ECS replica during the
~60s TTL window is exposed. No other call site needed changes; `setTierCache`/`setTierFailCache`
themselves were already correct (plain LRU-bounded Map writes) — the bug was entirely in
`resolveUserTier` writing to them without checking whether an invalidation happened mid-flight.

### Fix rationale

Mirrored `clerk-user-cache.ts`'s own fix exactly: a monotonic `tierInvalidationSeq` counter, bumped
by every `invalidateTierCache()` call (and therefore by `publishTierChanged`, which calls it).
`resolveUserTier` captures the counter immediately before its Clerk fetch and only writes to
`tierCache`/`tierFailCache` if nothing invalidated in the meantime — on either the success path
(`setTierCache`) or the failure path (`setTierFailCache`, so a stale-fetch failure doesn't impose an
unwarranted 15s backoff right after an invalidation asked for an immediate retry). The function
still *returns* whatever it actually read to its own caller in both cases — a caller can't un-ask a
question it asked before the write landed — the fix only prevents that known-stale read from being
written into the SHARED cache for every subsequent caller on that replica.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
