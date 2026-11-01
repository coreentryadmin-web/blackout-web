> **kind:** FINDING

## Admin `UserManagement.tsx`: `openUserDetail`'s per-row fetch had no out-of-order race guard — a slower, earlier-clicked row's response could overwrite the edit drawer with the wrong user's data — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** DISCOVERY-lane bug-hunting sweep, round 245, investigating round 244's carried-over
lead #3 ("`UserManagement.tsx`'s `openUserDetail` double-click-edit path").

**Root cause:** `openUserDetail` (`src/components/admin/UserManagement.tsx`) was a bare
`fetch(...).then(setSelectedUser)` with no generation/request-id guard:

```ts
const openUserDetail = async (userId: string) => {
  const res = await fetch(`/api/admin/users/${userId}`);
  if (!res.ok) return;
  const data: UserDetail = await res.json();
  setSelectedUser(data);
  setEditOpen(true);
};
```

The "Edit" button (`onClick={() => openUserDetail(user.id)}`, one per table row) has no
per-row/global loading or disabled state, so nothing prevents an admin from clicking a second
row — or double-clicking the same row — before the first `GET /api/admin/users/:id` request
resolves. Two overlapping requests for different `userId`s race with nothing stopping the
EARLIER-issued (but slower) response from resolving AFTER the LATER-issued (but faster) one and
unconditionally calling `setSelectedUser(data)` last, overwriting the edit drawer with a
different user's data than the row the admin most recently clicked.

This is the same "stale-fetch-race-without-generation-guard" shape already fixed 13 times this
sweep elsewhere in the codebase (`AdminApiEventDetail.tsx` #6926 being the closest precedent — a
per-row detail drawer with the identical overlapping-fetch shape), and the file already contains
the generic fix for it (`runGuardedUsersFetch`, in `user-management-request-guard.ts`) — it was
wired into `fetchUsers` (the un-debounced search-box list fetch) but never into `openUserDetail`.

**Blast radius / why this matters more than a typical display race:** `selectedUser` is not just
read-only display state — `EditUserModal`'s `onDelete={() => setDeleteConfirm(selectedUser)}`
(and the ban-confirm flow reads the same state) seeds the destructive-action confirm modals
directly from it. If a stale response wins the race, the edit drawer opens showing (and would
act on) a *different, real* user's data than the row the admin believes they just clicked — risk
of an admin banning or deleting the wrong account while trusting the drawer reflects their last
click. The two concrete callers of `openUserDetail` are the single call site at the row's "Edit"
button; no other code path calls it, so the fix closes the race completely for this surface.

**Fix:** reused the file's own existing `runGuardedUsersFetch` helper (already battle-tested via
`fetchUsers`'s identical race) with a **new, separate** ref (`latestUserDetailRequestIdRef`,
distinct from the list fetch's `latestUsersRequestIdRef`) so a response is only applied if no
newer `openUserDetail` call has started since:

```ts
const openUserDetail = async (userId: string) => {
  const requestId = ++latestUserDetailRequestIdRef.current;
  await runGuardedUsersFetch(
    requestId,
    () => latestUserDetailRequestIdRef.current,
    async () => {
      const res = await fetch(`/api/admin/users/${userId}`);
      if (!res.ok) return null;
      return (await res.json()) as UserDetail;
    },
    (data) => {
      if (!data) return;
      setSelectedUser(data);
      setEditOpen(true);
    }
  );
};
```

**Fix rationale:** deliberately reused the generic, already-unit-tested `runGuardedUsersFetch`
helper rather than writing a second bespoke guard — the same helper already closes an
isomorphic race for this file's list fetch, so this is one fewer independent implementation to
keep in sync. Deliberately a SEPARATE ref from `latestUsersRequestIdRef`: conflating the two
would make an ordinary list refetch (e.g. typing in the search box) spuriously invalidate an
in-flight detail fetch, or vice versa — the two fetches are independent and must not share a
counter.

**Evidence (RED → GREEN):** added a regression test to `UserManagement.test.ts` (this file has no
render harness — see its own header comment — so, matching its established convention, the test
asserts the wiring via source text, scoped to `openUserDetail`'s own function body): that it
routes through `runGuardedUsersFetch(`, bumps/reads its own `latestUserDetailRequestIdRef`, and
does NOT read the list fetch's `latestUsersRequestIdRef`. RED (verified via
`git stash push -- UserManagement.tsx`, keeping only the test): new test failed —
`"openUserDetail must route its fetch through runGuardedUsersFetch, not apply the response
unconditionally"` — while the other 6 pre-existing tests in the file stayed green. GREEN (fix
restored): `npx tsx --experimental-test-module-mocks --test UserManagement.test.ts` → 7/7 pass.
Also ran `user-management-request-guard.test.ts` (3/3 pass, unchanged) and `npx tsc --noEmit`
(clean, no new errors).
