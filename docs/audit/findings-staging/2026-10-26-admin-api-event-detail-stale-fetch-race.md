> **kind:** FINDING

## AdminApiEventDetail's forensics drawer could show the wrong event's data under a fast double-click — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | DISCOVERY sweep, round 121 (non-owned: `src/components/admin/AdminApiEventDetail.tsx`) |
| **Surface** | The "API call forensics" drawer opened from `AdminApiLiveFeed`/the Command Center call timeline — an admin clicks a row to inspect one API call's full detail (status, error, headers, retry chain, endpoint stats). |

### Root cause

`AdminApiEventDetail`'s detail fetch was a bare effect keyed on `eventId`:

```ts
useEffect(() => {
  if (!eventId) { setDetail(null); return; }
  setLoading(true);
  fetch(`/api/admin/apis/events/${encodeURIComponent(eventId)}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => setDetail(d))
    .finally(() => setLoading(false));
}, [eventId]);
```

There was no guard against an **earlier, slower request resolving after a later one**. If an
admin clicked event A, then clicked event B before A's request finished, two fetches were now
in flight (React effect re-runs on a dependency change do not cancel or ignore the prior run's
own promise chain — that is left entirely to the effect body). Whichever response landed
*last* won, regardless of which event it was actually for. So if A's (now-stale) response
happened to resolve after B's, `.then(setDetail)` fired last for A and silently overwrote the
drawer with **event A's forensics while the drawer was still open and titled for event B** —
wrong HTTP status, wrong error text, wrong headers/retry chain, with no visual indication
anything was inconsistent. For an admin mid incident-debug, rapidly clicking through several
rows in the live feed/timeline (the exact workflow this drawer exists for) is a realistic way
to trigger it.

### Evidence

New test `src/components/admin/admin-api-event-detail-stale-fetch.test.ts`. RED→GREEN proven
via `git stash` on `AdminApiEventDetail.tsx` alone (test file untouched): all 3 new tests fail
(`loadEventDetailIfCurrent is not a function` — the export didn't exist pre-fix) on the stashed
tree; restoring the fix makes all 3 pass. The main regression test simulates the exact race with
two independently-resolvable deferred promises (A requested first, B requested second, B's
response delivered first, A's delivered second) and asserts only B's data is ever applied and
A's stale `onSettled`/loading-clear is skipped too (so a slow stale response can't flip
`loading` back to `false` out from under the still-in-flight current request).

### Fix

Extracted the fetch-and-apply sequencing into a pure, exported, unit-testable helper
`loadEventDetailIfCurrent(eventId, fetchFn, getLatestId, apply, onSettled)`: it fetches detail
for `eventId`, then only calls `apply`/`onSettled` if `getLatestId()` still equals `eventId` at
resolution time. The component tracks the latest requested id in a ref (`latestEventIdRef`,
updated synchronously at the top of the effect, same turn as the new fetch starts) and passes
that as `getLatestId`. A request superseded by a newer one before it resolves is silently
dropped instead of applied — matching the existing `AdminApiLiveFeed`/live-feed convention of
"the latest click wins," which this drawer already implicitly promised just never actually
delivered once two requests overlapped.

### Fix rationale

Kept the fix entirely in this one component/helper rather than reaching for a shared
"cancellable fetch" utility — no sibling admin panel in this sweep showed the same unguarded
effect-fetch-on-id-change shape (checked `AdminApiLiveFeed.tsx`, `AdminCronDashboard.tsx`), so a
shared abstraction would be premature. The ref-based "latest id wins" guard (rather than an
`AbortController`) was chosen because the underlying request is a cheap admin-only read with no
side effects worth cancelling server-side — skipping the *apply* step is sufficient to fix the
user-visible bug, and keeps the change a pure addition with no behavior change to the fetch
itself.

### Blast radius

Single file + its new test. No other component reads `AdminApiEventDetail`'s internal fetch
effect; `eventId`/`onClose` props are unchanged.

### Gates

`npx tsx --experimental-test-module-mocks --test src/components/admin/*.test.ts` (Node 20,
39/39 pass, including the 3 new cases). `npx tsc --noEmit` clean. `npx eslint
src/components/admin/AdminApiEventDetail.tsx src/components/admin/admin-api-event-detail-stale-fetch.test.ts`
clean.
