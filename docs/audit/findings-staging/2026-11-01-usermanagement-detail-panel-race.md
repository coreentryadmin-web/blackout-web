> **kind:** FINDING

# Admin User Management detail panel — stale-fetch race could reopen/overwrite a different user's panel

| Field | Value |
|---|---|
| **Area** | Admin → User Management (`src/components/admin/UserManagement.tsx`) |
| **Severity** | P3 (admin-only tool, not member-facing; data-integrity risk for the admin's own workflow) |
| **Status** | Fixed |

## Root cause

`openUserDetail(userId)` and `syncWhop`'s own post-sync detail refresh each did a bare
`fetch(...)` followed by an unconditional `setSelectedUser(data)`, with **no guard at all**
against a later call superseding an earlier, still-in-flight one — the same shape of bug already
fixed independently in 14 other spots in this codebase (`ContractDrilldownDrawer.tsx`,
`AdminApiEventDetail.tsx` #6926, `FlowFeed.tsx`, `VectorChart.tsx`, etc.), but never applied here.

Two concrete races, both reachable from ordinary admin clicking (no artificial delay needed —
only requires two requests racing in the network, which any double-click or quick row-switch can
produce):

1. **`openUserDetail` vs `openUserDetail`.** Admin clicks user row A, then clicks user row B
   before A's (slower) response arrives. Both fetches run independently. If A's response resolves
   AFTER B's, nothing stopped `setSelectedUser(A's data)` from firing last and silently swapping
   the open panel from B back to A — the admin is now editing/looking at A's tools, billing and
   role controls while believing they're on B.
2. **`syncWhop`'s refresh vs `openUserDetail`.** Clicking "Sync" inside the modal captures
   `selectedUser` (A) in a plain JS closure. That closure value does **not** track later state
   updates — so if the admin closes A's panel and opens B's while the sync's `await fetchUsers()`
   and its own detail re-fetch are still in flight, the stale closure check
   (`selectedUser?.email === email`) still matches A, the detail re-fetch still runs for A, and
   the final `setSelectedUser(A's refreshed data)` overwrites B's now-open panel with A's data.
   Closing the panel entirely mid-sync has the same failure mode in a different guise: the late
   response can silently *reopen* a panel the admin had already dismissed.

## Evidence

Added `src/components/admin/user-management-request-guard.test.ts` cases that reproduce the exact
out-of-order resolution for both races (`applyUserDetailIfCurrent` — see Fix). RED→GREEN proof via
`git stash` of the two production files (keeping the new test):

- **Before the fix** (old `user-management-request-guard.ts` + old `UserManagement.tsx`): the 4
  new tests fail outright — `applyUserDetailIfCurrent` doesn't exist yet
  (`TypeError: applyUserDetailIfCurrent is not a function`), confirming no equivalent guard was in
  place. 3/7 tests pass (the pre-existing `runGuardedUsersFetch` tests, untouched).
- **After the fix**: 7/7 tests pass, including the two race reproductions
  (`applyUserDetailIfCurrent drops user A's late response once user B's panel is open`,
  `applyUserDetailIfCurrent drops a stale syncWhop refresh once a different user's panel is open`)
  and the panel-closed variant.

`npx tsc --noEmit` clean; `eslint` on the three touched files reports 0 errors (1 pre-existing,
unrelated `<img>` warning).

## Blast radius

Only `UserManagement.tsx`'s two call sites (`openUserDetail`, `syncWhop`) read/write
`selectedUser`/`editOpen` via fetch responses — no other component imports
`user-management-request-guard.ts`'s new export, and no other file calls `openUserDetail` or
`syncWhop`. The fix is localized to this one admin panel.

## Fix rationale

Added `applyUserDetailIfCurrent` to the existing, already-tested
`user-management-request-guard.ts` (sibling of the file's existing `runGuardedUsersFetch`, same
pattern as `AdminApiEventDetail.tsx`'s `loadEventDetailIfCurrent`) rather than inventing a new
module — it's generic (keyed by "current user id" instead of a bare counter, which is the more
natural key here since both race sites are about "which user is the open panel", not "which
request number is newest").

`UserManagement.tsx` now tracks the open panel's user id in a ref
(`selectedUserIdRef`), updated the moment a detail-open is requested and cleared on every path
that clears `selectedUser` (close, save, delete). Both `openUserDetail` and `syncWhop`'s refresh
route their `setSelectedUser` calls through `applyUserDetailIfCurrent`, which re-checks the LIVE
ref right before applying — not the stale closure value — so a response that's been superseded
(by a different user's panel, or by the panel being closed) is dropped instead of applied.

Deliberately left unchanged: `fetchUsers`'s own existing `runGuardedUsersFetch` guard (already
correct, unrelated counter), and the rest of `syncWhop`'s control flow (the
`selectedUser?.email === email` check still decides *whether* to refresh at all — that's a
different, lower-stakes question from *whether to apply* the refresh's result, which is what the
new guard answers).
