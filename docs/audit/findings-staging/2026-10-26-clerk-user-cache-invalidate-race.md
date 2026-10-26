> **kind:** `FINDING`

## `invalidateClerkUserCache` could be silently undone by an in-flight fetch that started before it — a just-written tool_access/admin-role change stayed stale for up to another 5s — FIXED

| | |
|---|---|
| **Severity** | P2 (auth/authorization staleness window — not a full bypass, but a bounded window where a just-revoked block or just-granted admin/tool_access override reads as the old value) |
| **Surface** | `src/lib/clerk-user-cache.ts` — `getClerkUserCached`/`invalidateClerkUserCache`, the shared 5s-TTL Clerk `users.getUser` dedupe read by `src/lib/tier-cache.ts`, `src/lib/tool-access-server.ts` (`loadUserToolAccess`, `userCanAccessTool`), `src/lib/admin-access.ts` (`isAdminUser`), and `src/lib/user-directory.ts`. Write-then-invalidate caller: `setToolAccessForUserId` in `src/lib/tool-access-server.ts`. |
| **Status** | FIXED |

### Root cause

`setToolAccessForUserId` (an admin mutation) follows the standard "write, then invalidate" shape:

```ts
await client.users.updateUserMetadata(userId, { publicMetadata: meta });
invalidateClerkUserCache(userId);
```

`invalidateClerkUserCache` only clears whatever is **currently sitting in** the `resolved`/
`inflight` maps. It cannot reach back and stop a fetch that **started earlier** — and therefore
already read Clerk's pre-write state — from completing afterward. `getClerkUserCached`'s in-flight
promise unconditionally called `setResolved(userId, user)` on resolution, with no check for
whether an invalidate had landed in the meantime:

```ts
const p = (async () => {
  const { clerkClient } = await import("@clerk/nextjs/server");
  const user = await (await clerkClient()).users.getUser(userId);
  setResolved(userId, user);   // <-- always writes, even if stale by now
  return user;
})();
```

Sequence that reproduces it: (1) an ordinary request calls `getClerkUserCached(userId)`, no cache
hit, kicks off a `getUser` fetch that reads Clerk's state *before* the write (Clerk's read latency
is ~100-300ms per this file's own header comment); (2) concurrently, an admin blocks/grants a tool
via `setToolAccessForUserId`, which writes the new `publicMetadata.tool_access` and calls
`invalidateClerkUserCache(userId)`; (3) step (1)'s fetch — already in flight, unaffected by the
invalidate call touching the maps it isn't in yet — resolves with the **pre-write** user object and
writes it into `resolved`, resurrecting exactly the staleness the invalidate was called to clear.
Every read for the next `DEDUPE_TTL_MS` (5s) now serves that stale snapshot instead of triggering a
fresh fetch, even though the caller explicitly invalidated right after writing. The same race
applies to any other write-then-invalidate caller and to `isAdminUser`/`userCanAccessTool`, since
they all read through the same cache.

### Evidence

New test `src/lib/clerk-user-cache-invalidate-race.test.ts`, 3 cases. RED→GREEN confirmed by
removing just the new generation guard (test file and seam untouched) and re-running:
- **Before the fix:** after a write-then-invalidate landing mid-flight, the next
  `getClerkUserCached` call is served the stale cached value instead of issuing a fresh Clerk
  call (both the per-user and the global/no-`userId` invalidate form) — 2 of 3 cases fail
  (`1 !== 2` on the expected post-invalidate Clerk call count).
- **After the fix:** all 3 cases pass — the stale in-flight write is suppressed, the next read
  issues a fresh call, and ordinary dedupe (no invalidate in between) still serves the cache as
  before (sanity case 3).

Mocking the real `@clerk/nextjs/server` package to drive this test hit a separate, previously
undocumented tooling gap worth recording: node:test's `--experimental-test-module-mocks`
`mock.module()` override of a bare npm specifier is observed by a dynamic
`import(bareSpecifier)` call issued from a plain, untransformed `.mjs`/`.js` ESM module, but
**not** by the textually-identical call issued from inside a `tsx`-compiled `.ts` module (every
`.ts` file in this repo) — confirmed empirically by swapping only the intermediary file's
extension between `.ts` and `.mjs` with everything else held constant. Since
`clerk-user-cache.ts` must stay `.ts`, the fix adds a narrow `__setFetchClerkUserForTest` seam
(same `*ForTest` convention already used by `resetPolygonCircuitForTest` /
`_resetZeroDteLiveMarksForTest` elsewhere in this repo) so the test can control fetch timing
directly instead of trying to mock the SDK import.

### Blast radius

Every reader of `getClerkUserCached` inherits the fix for free (no other call site needed
changes): `tier-cache.ts`'s `resolveUserTier`, `tool-access-server.ts`'s `loadUserToolAccess`/
`userCanAccessTool` (and therefore `canAccessTool`/`requireToolApi`/`requireAnyToolApi`),
`admin-access.ts`'s `isAdminUser`, and `user-directory.ts`. The only write-then-invalidate caller
today is `setToolAccessForUserId`, but the fix is general — it protects any future caller that
follows the same write-then-invalidate pattern against this same race, not just that one.

### Fix

Added a monotonically-incrementing `invalidationSeq` counter, bumped by every
`invalidateClerkUserCache()` call (both the per-user and the global/no-argument form).
`getClerkUserCached` captures the counter's value when it starts a fresh fetch and only calls
`setResolved` if the counter is unchanged when the fetch resolves — i.e. nothing invalidated the
cache while this specific fetch was in flight. If an invalidate landed in between, the fetch's
caller still gets the (now possibly stale) data it awaited — there's no way to retroactively fix
what was already read from Clerk — but the cache itself is left clean, so the very next read
issues a fresh call instead of serving the stale snapshot for the rest of the TTL window.

Also extracted the actual Clerk fetch behind an overridable `fetchClerkUser` reference (defaulting
to the original `await import("@clerk/nextjs/server")` call) with a `__setFetchClerkUserForTest`
setter, purely for testability — no behavior change on the real path.

### Fix rationale

Considered a per-user generation map (`Map<userId, number>`) instead of one global counter, to
avoid a rare, harmless over-cautious case: an invalidate for user B landing while user A's
unrelated fetch is in flight would, under the global counter, also skip caching A's result (one
extra Clerk call next time, not a correctness issue). Chose the single global counter anyway —
it's simpler, impossible to get subtly wrong (no reset-to-0-after-clear edge case a per-user map
would need to avoid reintroducing the same bug on its own global-clear path), and invalidate calls
are rare admin-only events, so the performance cost of the occasional extra Clerk call is
negligible next to the complexity saved. Left `setResolved`'s own LRU/eviction logic and the
`inflight` promise-sharing path untouched — this bug is specific to the write-after-resolve step,
not the dedupe mechanism itself.

### Tests

`src/lib/clerk-user-cache-invalidate-race.test.ts` (new, 3 cases). Full existing suite touching
this cache re-run and confirmed green: `clerk-user-cache-freshness.test.ts`,
`tier-cache-fail-backoff.test.ts`, `tier-cache-jwt-downgrade.test.ts`,
`tier-cache-freshness.test.ts`, `tool-access-server.latency.test.ts`,
`tool-access-server-block-override.test.ts`,
`src/app/(site)/__tests__/gated-route-redirects.test.ts` (34/34 pass). `npx tsc --noEmit` clean.
`npx eslint` clean on both changed files.
