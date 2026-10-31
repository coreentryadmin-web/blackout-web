> **kind:** FINDING

## Admin Operations Center audit-trail filter — stale out-of-order response overwrites the screen — FIXED

**Component:** `src/components/admin/AdminOperationsDashboard.tsx` (Audit Trail panel)
**Fix:** `src/components/admin/admin-operations-audit-request-guard.ts` (new, `runGuardedAuditLoad`)
**Status:** FIXED, PR open

### Root cause

`loadAudit()` fetches `GET /api/admin/audit-log?...` and is invoked from TWO
independent triggers that can both be in flight at once:

1. a 30s background poll (`AUDIT_MS`), and
2. every keystroke in either free-text filter box (`FilterSearch` "Action" /
   "Actor" — plain `<input type="search">` with `onChange={(e) =>
   onChange(e.target.value)}`, **no debounce**), which calls
   `setAuditAction`/`setAuditActor` directly. Both are deps of the `loadAudit`
   `useCallback`, and that callback is in turn the sole dependency of the
   `useEffect` that calls it, so every filter keystroke tears down and
   restarts the whole load.

Nothing tracked which `loadAudit()` call was issued most recently. So typing
"AAP" then quickly "AAPL" in the Actor filter fires two overlapping
`fetch(/api/admin/audit-log?actor=AAP...)` / `?actor=AAPL...` requests, and if
the earlier ("AAP") request happens to resolve *after* the later, faster
("AAPL") one — a perfectly normal network ordering, not a pathological
case — its response silently overwrites `audit.entries` with results for a
filter the admin has already typed past. The same shape applies to the
background poll: a poll tick that started just before a filter change can
resolve after the filter-change request and revert the panel back to the
unfiltered (or previous-filter) rows, undoing what the admin just typed.

This is byte-for-byte the same bug shape already found and fixed twice
elsewhere in this exact admin surface:
- `user-management-request-guard.ts` (#6927) — `UserManagement.tsx`'s search
  box, keyed by free-text search term.
- `admin-api-dashboard-request-guard.ts` — `AdminApiDashboard.tsx`'s telemetry
  poll vs. manual Rescan/Probe actions, keyed by "which `load()` call fired
  most recently".

`AdminOperationsDashboard.tsx`'s own Audit Trail panel has the identical
multi-trigger-fetch-no-guard shape (interval poll + free-text filter, no
debounce) but had not been fixed — it was not in scope for either prior PR
and had not otherwise been audited.

### Evidence

Added `src/components/admin/admin-operations-audit-request-guard.test.ts`
with a deferred-promise harness that models the exact race: request 1
("AAP"/poll) starts first but is the slow one; request 2 ("AAPL"/filter
change) starts second, supersedes it, and resolves first; request 1's
response arrives after request 2's has already been applied.

- **RED (pre-fix):** temporarily replaced `runGuardedAuditLoad` with a
  pass-through (`applyResult(await doFetch())`, no `requestId` check) via
  `git stash`-equivalent swap of the guard source file alone — 3 of 4 tests
  failed, e.g.:
  ```
  the stale poll response must never overwrite the filtered audit rows already applied
  + actual - expected
    [
      'filtered audit rows',
  +   'unfiltered poll audit rows'
    ]
  ```
- **GREEN (post-fix):** restored the real guard — all 4/4 pass.
- Ran all sibling admin guard/test files alongside it (43 tests total across
  `admin-operations-audit-request-guard.test.ts`,
  `admin-api-dashboard-request-guard.test.ts`,
  `user-management-request-guard.test.ts`, `AdminCronDashboard.test.ts`,
  `AdminLaunchStatusPanel.test.ts`, `AdminUi.test.ts`,
  `UserManagement.test.ts`, `JournalEditor.test.ts`,
  `admin-store-age.test.ts`, `admin-time-ago.test.ts`) — 43/43 pass, no
  regressions.
- `tsc --noEmit` and `eslint` clean on all touched files.

### Blast radius

Only `AdminOperationsDashboard.tsx`'s `loadAudit` call site is affected —
`loadErrors` (the panel directly above it) has no user-controllable filter
input and only the one poll trigger, so it was not in scope for this same
bug (single trigger can't race with itself in a meaningful way here, and
it isn't). No other component calls `runGuardedAuditLoad` or imports this
new guard module.

### Fix rationale

Followed the exact, already-established pattern in this codebase rather than
inventing a new one: a small, React/DOM-free, directly-unit-testable guard
function (`runGuardedAuditLoad`) that the caller wires up with a `useRef`
counter bumped on every `loadAudit()` invocation. The response is only
applied if no newer `loadAudit()` call has started since — the guard drops
the superseded side only, never blocks the newer one, and a superseded
request's own *failure* is likewise prevented from clobbering a newer,
already-applied *success* (mirrored from `AdminApiDashboard.tsx`'s own
`load()`/`catch`/`finally` guard-plus-requestId-recheck shape).

Deliberately kept this as its OWN small guard module
(`admin-operations-audit-request-guard.ts`) rather than generalizing
`runGuardedDashboardLoad`/`runGuardedUsersFetch` into one shared helper —
that mirrors how this repo already has two near-identical copies for the
same bug shape in two other components; a refactor to a single shared
utility is a reasonable follow-up but out of scope for a single-issue PR.
