> **kind:** FINDING

## Clerk user-cache in-flight dedupe: a stale fetch's `finally{}` can evict a DIFFERENT, still-pending fetch's entry — FIXED

| Field | Value |
|-------|-------|
| **Severity** | P2 (performance/correctness of the dedupe layer itself — not a data-staleness bug; the existing invalidation-race guard in the same file already prevents stale data from being served. This is the dedupe mechanism quietly defeating itself in exactly the race window that guard documents.) |
| **Surface** | `src/lib/clerk-user-cache.ts` — `getClerkUserCached`'s `inflight` Map, read by every `isAdminUser`/`loadUserToolAccess`/`getUserProfile` call site across admin-access.ts, tool-access-server.ts, tier-cache.ts, user-directory.ts. |
| **Status** | FIXED |
| **Found** | 2026-10-31, round 197 discovery sweep (primary target: `clerk-user-cache.ts`, flagged across 2 prior rounds as high-value, read in full for the first time). |

### Root cause

`getClerkUserCached` deduplicates concurrent Clerk `getUser` calls for the same `userId` via an
`inflight: Map<string, Promise<ClerkUser>>`. The cleanup after a fetch resolves was unconditional:

```ts
inflight.set(userId, p);
try {
  return await p;
} finally {
  inflight.delete(userId);   // <-- deletes whatever is CURRENTLY at this key
}
```

This file already has a documented, fixed race for *data* staleness: `invalidateClerkUserCache
(userId)` can run while an older fetch (started before an admin write) is still in flight; that
fetch's `seqAtStart === invalidationSeq` guard correctly stops it from writing its stale result
into `resolved`. But `invalidateClerkUserCache` also does `inflight.delete(userId)` — it clears
the OLD fetch's in-flight slot. If a new caller arrives in that same window, `getClerkUserCached`
correctly finds nothing pending and starts a brand-new fetch #2, registering ITS promise at
`inflight.set(userId, p2)`.

When the OLD fetch (#1) finally resolves, its `finally { inflight.delete(userId) }` fires — and
deletes whatever is *currently* stored at `inflight.get(userId)`, which by now is fetch #2's
promise, not fetch #1's own. Fetch #2 is still pending. A third caller arriving before fetch #2
resolves finds `inflight.get(userId)` empty (wrongly deleted) and starts a redundant fetch #3,
instead of being deduped onto the already-in-flight fetch #2 — exactly the fan-out
(`isAdminUser` + `requireTier` + `canAccessTool` + `loadUserToolAccess` calling this within one
request) this module's own header comment says it exists to collapse.

The bug is not confined to the invalidation path by code shape — any two overlapping fetches for
the same `userId` that both get registered in `inflight` at different times will have this
problem the instant the earlier one resolves — but in practice the only way a SECOND fetch for
the same still-cold `userId` gets started while a FIRST is in flight is if something cleared the
first one's inflight entry early, which in this codebase is exactly what
`invalidateClerkUserCache` does. So the trigger is real and already exercised by production
code (`setToolAccessForUserId` in `tool-access-server.ts` calls
`invalidateClerkUserCache(userId)` right after every metadata write).

### Evidence

New test `src/lib/clerk-user-cache-invalidate-race.test.ts` (extended the existing race-test
file, same `__setFetchClerkUserForTest` seam already used by its 3 sibling cases), case: *"a
stale pre-invalidate fetch's finally{} must not evict a DIFFERENT, still-pending fetch's
inflight entry"*.

- **RED (pre-fix, `git stash` on `clerk-user-cache.ts` alone):** fetch #1 starts, invalidate
  clears its slot, fetch #2 starts (2 Clerk calls so far), fetch #1 resolves and its `finally`
  wipes fetch #2's live slot, a third concurrent caller then starts a redundant fetch #3 —
  `getUserCallCount` is `3` where the test expects `2`:
  ```
  not ok 3 - ... must not evict ... still-pending fetch's inflight entry
    error: 3 !== 2 (actual vs expected)
  ```
- **GREEN (post-fix):** all 4 cases in the file pass, `getUserCallCount` stays at `2` — the
  third caller correctly reuses fetch #2's pending promise and all three readers resolve to the
  same, correct post-invalidation value.
- Full suite of every test touching this cache re-run clean on Node 20
  (`clerk-user-cache-invalidate-race.test.ts`, `clerk-user-cache-freshness.test.ts`,
  `tier-cache-invalidate-race.test.ts`, `tool-access-server-metadata-race.test.ts`,
  `tool-access-server.latency.test.ts`, `tool-access-server-block-override.test.ts`,
  `gated-route-redirects.test.ts`): 28/28 pass.
- `npx tsc --noEmit` clean.

### Blast radius

`clerk-user-cache.ts` only — the fix touches just the `finally` block in `getClerkUserCached`.
Every consumer (`admin-access.ts`'s `isAdminUser`, `tool-access-server.ts`'s
`loadUserToolAccess`/`userCanAccessTool`, `tier-cache.ts`, `user-directory.ts`'s
`getUserProfile`) benefits automatically since they all funnel through this one function; none
needed changes. No behavior change for the common case (no concurrent invalidation mid-fetch) —
`inflight.get(userId) === p` is true for the overwhelming majority of calls, so the delete still
fires exactly as before.

### Fix rationale

Guard the delete with an identity check: only remove the `inflight` entry if it is still *our
own* promise `p`, the same "don't clobber someone else's slot" pattern already used correctly
elsewhere in this file's sibling `setResolved`/`invalidationSeq` guard (which checks "did anything
change under me" before writing, rather than writing unconditionally). This is the minimal fix —
it does not change when invalidation happens, when new fetches start, or the TTL/eviction
behavior; it only stops a finished fetch from deleting a *different*, newer fetch's still-live
bookkeeping entry.

An alternative considered and rejected: making `invalidateClerkUserCache` NOT delete the
`inflight` entry (only `resolved`). That would be a larger behavior change (an invalidate-then-
immediate-read would then wait on/reuse the stale in-flight fetch's promise instead of starting
a fresh one, reintroducing a window where a just-invalidated read is served the pre-write value)
and would touch the already-carefully-reasoned invalidation semantics documented at the top of
the file. The identity-checked delete fixes the dedupe bug without touching that contract at all.
