> **kind:** FINDING

# X Intel queue standalone page had the stale status-filter fetch race the sibling panel already fixed

| | |
|---|---|
| **Area** | Admin / X Intel (`src/app/(site)/admin/x-intel/page.tsx`) |
| **Severity** | P3 — admin-only tooling, but the symptom is a real, silent data-integrity illusion: the filter buttons show one status selected while the table shows rows from a different one |
| **Status** | FIXED — PR open (`fix/x-intel-queue-page-stale-filter-race`) |

## Root cause

`XIntelQueuePage` (`src/app/(site)/admin/x-intel/page.tsx`) is a standalone duplicate of the
X Intel queue view that is also embedded, properly guarded, as `AdminXIntelQueuePanel.tsx` inside
`AdminAnalyticsDashboard.tsx`. The standalone page's `fetchQueueRows()` closed over `status` and
was invoked, completely unguarded, every time the admin clicked a different status filter button
(`ALL`/`READY`/`REVIEW`/`SKIP`):

```ts
useEffect(() => {
  fetchQueueRows();
}, [status]);

async function fetchQueueRows() {
  setLoading(true);
  setError(null);
  try {
    const url = new URL("/api/admin/x-intel/queue", window.location.origin);
    url.searchParams.set("status", status);
    url.searchParams.set("limit", "50");
    const res = await fetch(url.toString());
    ...
    setRows(data.rows || []);
  } ...
}
```

No `AbortController`, generation ref, or `cancelled` flag guarded `setRows()`. Clicking a new
filter while the PREVIOUS filter's request was still in flight let that older, slower response
land AFTER the newer one and silently overwrite the table — the filter buttons would show (say)
`SKIP` active while the list still (or again) showed `ALL`'s rows, whichever fetch happened to
resolve last.

This is the exact `stale-fetch-race-without-generation-guard` / `duplicated-logic-drift` shape
already fixed three times in this same admin surface: `AdminApiDashboard.tsx` (#6926),
`UserManagement.tsx` (#6927), and — most relevantly — the sibling `AdminXIntelQueuePanel.tsx`'s
own `load()`, via the shared `runGuardedXIntelQueueLoad` helper
(`src/components/admin/x-intel-queue-request-guard.ts`), whose own doc comment describes this
precise race ("switching the status filter dropdown... recreates load()... an earlier request...
can resolve after... and overwrite the screen"). The standalone page is a separate, undocumented
duplicate of that panel's queue view that simply never received the fix when the panel did.

## Evidence

- Read the original `fetchQueueRows()` end to end: no cancellation mechanism of any kind, unlike
  every other filter-driven fetch site in this admin surface (`AdminXIntelQueuePanel.tsx`,
  `AdminApiDashboard.tsx`, `AdminOperationsDashboard.tsx`'s audit-trail filter).
- The fix reuses, rather than reimplements, `runGuardedXIntelQueueLoad` — already unit-tested
  (`x-intel-queue-request-guard.test.ts`, 3 tests) for the byte-identical race shape on the
  sibling panel's `load()` closure. Re-ran those tests against the updated tree: all 3 green
  (`npx tsx --experimental-test-module-mocks --test
  src/components/admin/x-intel-queue-request-guard.test.ts`). The guard's correctness is proven
  generically; this fix is wiring, not new logic.
- `tsc --noEmit` clean on the updated file (Node 20).

## Fix

Reuse `runGuardedXIntelQueueLoad` (same helper the sibling panel already uses), keyed by a
`latestLoadRequestIdRef` bumped once per `fetchQueueRows()` call. A response is only applied if
its request is still the most recently issued one; a superseded request's own error is also
dropped rather than clobbering a newer, already-applied success — mirroring the panel's own
catch/finally guards exactly.

## Blast radius

`src/app/(site)/admin/x-intel/page.tsx` only. The sibling panel and the shared guard helper are
untouched; no other call site duplicates this page's `fetchQueueRows()` closure.

## Why not caught earlier

The page predates (or was simply never reconciled with) the panel's embedding into
`AdminAnalyticsDashboard.tsx` and the #6926/#6927-family race-guard sweep that followed. Nothing
links the two queue views in code — they just happen to read the same API and render similar
rows — so a fix to one silently left the other's identical bug in place. No existing test covered
this standalone page's component wiring (the convention in this codebase is to unit-test the
extracted pure/guard logic, not the React effect wiring itself), so nothing caught the drift.
