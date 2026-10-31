> **kind:** FINDING

## Admin X Intel Queue panel: status-filter dropdown races the background poll — FIXED

**Status:** Fixed, regression test added (`src/components/admin/x-intel-queue-request-guard.test.ts`).

### Root cause

`AdminXIntelQueuePanel.tsx`'s `load()` closes over the `status` filter state:

```ts
const load = useCallback(async () => {
  try {
    const res = await fetch(`/api/admin/x-intel/queue?status=${status}&limit=50`, { cache: "no-store" });
    ...
    setRows(json.rows);
    setError(null);
  } catch (e) { ... }
}, [status]);

useEffect(() => {
  void load();
  const t = setInterval(() => void load(), REFRESH_MS);
  return () => clearInterval(t);
}, [load]);
```

Two independent triggers can both be in flight at once: the 120s background
poll, and the status filter `<FilterSelect>` — switching it (e.g. "ALL" ->
"SKIP") changes `status`, which gives `load` a new identity, which re-runs the
`useEffect`: the cleanup clears the old interval (but does **not** cancel any
already-in-flight fetch), then immediately calls the new `load()` for the new
filter and arms a fresh interval.

Nothing tracked which `load()` call was issued **last**. If a poll tick for
the OLD filter ("ALL") was already in flight when the admin switched to
"SKIP", and that older request happens to resolve **after** the newer,
filter-driven "SKIP" request (ordinary network jitter — nothing exotic is
needed), `setRows(json.rows)` from the stale "ALL" response overwrites the
screen: the dropdown still reads "Skip" selected, but the table silently
repaints with the full unfiltered row set (or vice versa, depending on which
filter resolves last). This is the admin-facing symptom — a filter that
appears to apply, then un-applies itself a moment later with no interaction
from the admin.

This is the same bug shape already fixed twice in this exact file area:
`admin-api-dashboard-request-guard.ts` (#6926/#6990-era fix for
`AdminApiDashboard.tsx`'s multi-trigger `load()`) and
`user-management-request-guard.ts` (#6927, the User Management search box).
Round 140 of this sweep flagged this exact component/control as worth a
closer confirmatory look ("even a fixed-set dropdown can race if a user
clicks through options fast while a poll is in flight") without confirming
it — this round confirmed it.

### Evidence

New test `src/components/admin/x-intel-queue-request-guard.test.ts` models the
exact race: request 1 ("ALL rows") starts first but is the slow one; request
2 ("SKIP rows") starts second, supersedes it, and resolves first; request 1's
response arrives after request 2's has already been applied.

- **RED (guard's own superseded-check removed):** of the 3 tests, 2 failed —
  the stale `"ALL rows"` response was applied on top of `"SKIP rows"`,
  producing `["ALL rows", "SKIP rows"]` instead of `["SKIP rows"]` (and the
  "applies when still current" direction broke too, since nothing distinguished
  stale from current). Proven via a scratch edit removing the `if
  (getLatestRequestId() !== requestId) return;` check, not `git stash` (the
  guard module is new, untracked at HEAD), then restored byte-for-byte.
- **GREEN (guard restored):** all 3 tests pass — the stale response is
  dropped, and a response that is still current applies, including when it
  resolves last.
- `npx tsc --noEmit` clean on the whole project after the change.
- `eslint` on the touched files: 0 new errors/warnings (the single pre-existing
  `react-hooks/exhaustive-deps` warning on the unrelated `display` memo was
  already present on `main` before this change).
- Sibling regression suites re-run clean: `queue-fixtures-gate.test.ts`,
  `queue-status-counts.test.ts`, `user-management-request-guard.test.ts`,
  `admin-api-dashboard-request-guard.test.ts` — 16/16 pass.

### Blast radius

Single call site: `AdminXIntelQueuePanel.tsx`'s own `load()`. No other
component imports or duplicates this panel's fetch logic. The fix does not
change the request URL, auth, or response shape — only which of two
in-flight responses is allowed to paint the screen.

### Fix rationale

Followed the exact, already-established pattern in this codebase
(`admin-api-dashboard-request-guard.ts`, `user-management-request-guard.ts`):
a small, pure, React/DOM-free helper (`runGuardedXIntelQueueLoad`) that takes
a `requestId`, a `getLatestRequestId()` accessor, the fetch, and the apply
callback, and only applies the result if no newer request has started since.
Wired into the component via a `latestLoadRequestIdRef` bumped once per
`load()` call, mirroring `UserManagement.tsx`'s `fetchUsers`/
`latestUsersRequestIdRef` wiring verbatim. Considered (and rejected) an
`AbortController` instead — it would also work, but every sibling fix in this
file area already uses the request-id-counter shape, and matching it keeps
the three guards trivially comparable/auditable as one pattern rather than
two different mitigations for the identical bug class. The error path was
also guarded (a superseded request's failure must not clobber a newer,
still-pending request's eventual success) — the two prior sibling fixes
guard only the success path's `applyResult`, but this panel's `catch` block
writes state too (`setError`/`setRows(null)`), so leaving it unguarded would
have left half the race intact.

### Deliberately left unchanged

- The 120s poll cadence (`REFRESH_MS`) — unrelated to this bug.
- The pre-existing `react-hooks/exhaustive-deps` warning on the `display`
  memo — out of scope, not touched by this change, not a correctness bug.
- `shouldShowXIntelFixtures` / `computeXIntelStatusCounts` — unrelated, both
  already covered by their own passing test suites, re-run here only to
  confirm no regression.
