> **kind:** `FINDING`

## Admin User Management search box could show results for an earlier, already-abandoned query — a classic stale-out-of-order-fetch race — FIXED

| | |
|---|---|
| **Severity** | P3 (admin-only tooling, never member-facing; wrong rows render transiently in the admin user table — a search, ban, or edit action taken against what's on screen could target the wrong user if an admin acts in the small window before a correct, newer response is ever issued) |
| **Surface** | `src/components/admin/UserManagement.tsx` — `fetchUsers` / the search box's `useEffect(() => { fetchUsers(); }, [fetchUsers])` |
| **Status** | FIXED |

### Root cause

`UserManagement`'s search input (`FilterSearch`, via `handleSearch`) has no debounce — every
keystroke calls `setQuery(v)`, which changes `fetchUsers`'s identity (it's a `useCallback` keyed on
`[page, pageLimit, query, accessFilter, roleFilter]`), which re-runs the `useEffect` and fires a
brand-new `GET /api/admin/users?q=...` request immediately.

Nothing tracked which request was the most recently issued one. So typing "AAP" then quickly typing
"AAPL" fires two overlapping requests, and whichever one's HTTP response happens to arrive LAST wins
— even if it's the EARLIER, now-abandoned "AAP" request, which can easily resolve after "AAPL"'s if
the server's query-building step (or just normal network jitter) makes the first call slightly
slower:

```tsx
// before fix
const fetchUsers = useCallback(async () => {
  setLoading(true);
  const params = new URLSearchParams({ page: String(page), limit: String(pageLimit) });
  if (query) params.set("q", query);
  ...
  const res = await fetch(`/api/admin/users?${params}`);
  if (!res.ok) return;
  const data: UsersResponse = await res.json();
  setUsers(data.users);       // <-- applied unconditionally, regardless of whether `query`
  setTotal(data.total);       //     (and therefore this exact request) is still current
  ...
}, [page, pageLimit, query, accessFilter, roleFilter]);

useEffect(() => { fetchUsers(); }, [fetchUsers]);
```

This is the identical bug shape to the one just fixed in `AdminApiEventDetail.tsx` (#6926) for the
API-forensics drawer's per-event detail fetch — a component does `useEffect(() => { fetch(...).then(setState) }, [someKey])` with no abort-controller and no "is this response still current"
guard — just triggered here by free-text search input instead of a selected id, and in a sibling
admin component `AdminApiEventDetail.tsx`'s own fix didn't touch.

### Evidence (RED → GREEN)

New file `src/components/admin/user-management-request-guard.ts` exports
`runGuardedUsersFetch(requestId, getLatestRequestId, doFetch, applyResult)`, a framework-free async
helper that only calls `applyResult` once `doFetch()` resolves AND `requestId` is still the latest
value `getLatestRequestId()` reports — i.e. no newer request has started since this one was issued.

New test file `src/components/admin/user-management-request-guard.test.ts` (3 tests) reproduces the
out-of-order scenario directly with deferred promises:
- Request 1 ("AAP") starts first but is slow; request 2 ("AAPL") starts second and resolves FIRST;
  request 1's response then arrives AFTER request 2's — **before fix (file doesn't exist /
  `UserManagement.tsx` applies every response unconditionally): the stale "AAP" result would have
  overwritten the already-rendered "AAPL" result. After fix: only `"AAPL results"` is ever applied**
  (`assert.deepEqual(applied, ["AAPL results"])`).
- A lone, un-superseded request is still applied normally (no change in the common case).
- A response that resolves LAST but is still the latest request (nothing superseded it) is still
  applied — the guard drops only genuinely SUPERSEDED requests, not merely "didn't resolve first."

RED→GREEN proved via `git stash`/`git stash pop`: stashing the fix removes the new helper + test
files and reverts `UserManagement.tsx`, so the test file no longer exists and the run fails
immediately (`Could not find '.../user-management-request-guard.test.ts'`) — confirming there is no
pre-existing guard. Restoring the stash and re-running: `tests 3 / pass 3 / fail 0`.

`npx tsc --noEmit` clean; `npx eslint src/components/admin/UserManagement.tsx
src/components/admin/user-management-request-guard.ts
src/components/admin/user-management-request-guard.test.ts` — 0 errors (one pre-existing,
unrelated `<img>`/LCP warning on a line this change didn't touch).

### Blast radius

Only `UserManagement.tsx`'s `fetchUsers` called the unguarded pattern on a changing free-text key —
its other fetches (`openUserDetail`, ban/delete/sync/create actions) are one-shot, imperative calls
triggered by a discrete user action (click a row, confirm a modal), not re-fired on every keystroke
of a shared key, so they don't share this race shape and were left unchanged. `AdminApiDashboard.tsx`
polls on fixed intervals (not a changing search key) and was also left unchanged — a different,
narrower concern noted but not fixed here (polling responses can still theoretically overlap, but
there is no user-typed key driving rapid-fire requests, so the practical exposure is far smaller and
out of scope for this fix).

### Fix rationale

Extracted the ordering check into a small, pure, DOM/React-free function
(`runGuardedUsersFetch`) rather than inlining an `if` after the `await` in `fetchUsers` directly,
matching the pattern `AdminApiEventDetail.tsx`'s own fix (#6926) establishes for this bug class —
this repo's "use client" components are tested via source-text assertions only (no React Testing
Library/jsdom in `package.json`), so the actual async-ordering logic needs to live somewhere
testable with real deferred promises, outside the component. `fetchUsers` now bumps a
`useRef`-held counter (`latestUsersRequestIdRef`) before each fetch and passes a closure reading
that same ref as `getLatestRequestId`; the `finally` block's `setLoading(false)` is likewise gated
on `latestUsersRequestIdRef.current === requestId` so a superseded request can't flip the loading
spinner off out from under the request that replaced it.
