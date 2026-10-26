> **kind:** FINDING

## `useAdminFlag`'s SWR cache key isn't scoped by `userId` — a rapid sign-out→sign-in can flash the previous user's cached admin flag — FIXED

**Status**: FIXED — `src/hooks/use-admin-flag.ts` (PR #TBD)

### Root cause

`useAdminFlag()` (`src/hooks/use-admin-flag.ts`) backs the shared admin flag used by global `Nav`
and the iOS chrome. Its SWR key was the bare literal string `"/api/admin/me"`:

```ts
const { data } = useSWR<AdminMeResponse>(
  isLoaded && isSignedIn && userId ? "/api/admin/me" : null,
  fetchAdminMe,
  { revalidateOnFocus: false, dedupingInterval: 60_000, ... }
);
```

SWR's cache is global and keyed purely by this string — it has no awareness of *which* signed-in
user is asking. Clerk's `UserButton` (`AuthUserMenu.tsx`) performs a client-side SPA sign-out
(`clerk.signOut()`, no forced page reload — confirmed by reading `src/lib/auth-client.tsx`), and
the subsequent sign-in (`/sign-in`, a client-side Next.js route) keeps the same JS runtime alive,
so the module-level SWR cache survives across a sign-out→sign-in in the same tab. Combined with
`dedupingInterval: 60_000`, this means: User A signs in (cache populated under
`"/api/admin/me"` → `{admin: <A's value>}`), signs out, and User B signs in within that same
60-second window — SWR immediately serves User A's stale cached `admin` flag to User B's render
(synchronously, before the background revalidation fetch resolves), briefly showing or hiding the
admin nav affordance based on the *wrong* user's permission.

Confirmed no sign-out handler anywhere in the app clears SWR's cache (`grep -rn "SWRConfig\|cache.clear\|mutate("`
found no `mutate()`/cache-clear call tied to sign-out) — the only thing preventing a leak while
actually signed-out is the hook's own `if (!isLoaded || !isSignedIn) return false;` guard, which
does nothing once User B is signed back in under the same cache key.

### Evidence

Added `adminMeSwrKey(isLoaded, isSignedIn, userId)` as an exported, directly-unit-tested pure
function. RED→GREEN via a temp-file swap (not `git stash`): against the pre-fix file, the new test
file fails to even load (`adminMeSwrKey is not a function` — the helper didn't exist, confirming
the old code had no per-user key isolation at all); against the fix, all 9 tests in
`use-admin-flag.test.ts` pass, including:
- two different signed-in users produce different cache keys (`JSON.stringify` inequality),
- the *same* user re-rendering still produces the *same* key (so `dedupingInterval` still
  correctly avoids refetching on every render for one user — the fix doesn't regress the original
  dedup optimization),
- signed-out / not-yet-loaded / no-userId all still correctly resolve to `null` (no fetch, no
  stale serve).

Sibling test files that import this module (`JournalEditor.test.ts`, `admin-health-cache.test.ts`)
re-run clean: 18/18 total. Lint + `tsc --noEmit` clean.

### Blast radius

Single hook (`useAdminFlag`), consumed by `Nav.tsx` (desktop + mobile nav) and the iOS chrome —
both get the fix automatically since they go through this one shared hook (the file's own comment:
"was duplicate fetch per mount" before being centralized here). No other `useSWR` call site in
non-owned code keys by a fixed, non-per-user string while gated on `isSignedIn`/`userId` (checked
via repo-wide grep) — this was the only instance of the pattern.

### Fix rationale

Changed the SWR key to an array `[url, userId] as const` and adjusted the fetcher to a thin
`([url]) => fetchAdminMe(url)` wrapper so the actual network request is unchanged — only the SWR
cache's own internal key (which is independent of what URL the fetcher ultimately calls) now
includes `userId`, giving each signed-in user their own cache bucket. This is the standard SWR
idiom for "same endpoint, cache-scoped by an extra dimension" and requires no change to the
`/api/admin/me` route itself. Left the existing `dedupingInterval: 60_000` and
`revalidateOnFocus: false` untouched — those are correct per-user behavior, the bug was purely the
missing per-user dimension on the cache key.
