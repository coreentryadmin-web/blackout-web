> **kind:** FINDING

## X-Intel queue detail page — stale-fetch race could show the wrong row — FIXED

**Status:** FIXED (PR, `fix/xintel-detail-stale-fetch-race`)

### Root cause

`src/app/(site)/admin/x-intel/[id]/page.tsx` fetched the queue row for its `[id]` route param
with a bare `fetchRow().then(setRow)` keyed by `useEffect(..., [id])`, with no guard against an
earlier, slower request resolving AFTER a later one.

The Next.js App Router does **not** remount this page component when navigating between two
sibling detail routes (`/admin/x-intel/123` -> `/admin/x-intel/456`) — it's the same mounted
component, so the effect just re-runs with a new `id`. If an admin opened row `123`, then clicked
into a different row `456` before `123`'s fetch resolved, two requests were in flight
concurrently. If `123`'s (slower) response happened to land *after* `456`'s, its unconditional
`setRow(found)` would silently repaint the page with row `123`'s headline, post copy and
"record tweet ID" form — while the URL, title and everything else on screen still said `456`.
Submitting the tweet-ID form from that state would have recorded the pasted tweet ID against the
**wrong** queue cycle (`row.cycle_key` for the stale row, not the one the admin thinks they're
looking at).

This is the exact bug class `AdminApiEventDetail`'s `loadEventDetailIfCurrent` already fixes for
the admin API event drawer (round 121, `src/components/admin/AdminApiEventDetail.tsx`) — same
shape (fetch keyed on a changing id, no generation/staleness guard), different surface.

### Evidence

Reproduced the unguarded behavior directly: with request `123` resolving after 20ms and request
`456` after 5ms, a bare `fetchFn().then(setRow)` applies `456` first (correct, momentarily) and
then **123 clobbers it last** — `applied order: [{"id":"456"},{"id":"123"}]`. This is exactly the
out-of-order resolution the original `page.tsx` had no protection against.

RED -> GREEN: `src/app/(site)/admin/x-intel/[id]/x-intel-row-race-guard.test.ts` exercises the
new `loadXIntelRowIfCurrent` guard directly — an earlier request's success AND its error are both
confirmed dropped once a newer id has been requested, while the single-in-flight-request case
(no false negatives) still applies correctly. All 3 tests pass against the fix.

```
npx tsx --experimental-test-module-mocks --test "src/app/(site)/admin/x-intel/[id]/x-intel-row-race-guard.test.ts"
# tests 3, pass 3, fail 0
```

`tsc --noEmit` clean.

### Blast radius

Single call site (`fetchRow`), called from the mount/id-change effect and from `recordTweetId`'s
post-submit refetch — both now thread the specific `requestedId` through the guard rather than
closing over a possibly-stale `id`. No other component shares this fetch.

### Fix rationale

Mirrored the already-shipped, already-tested pattern (`loadEventDetailIfCurrent`) rather than
inventing a new one: a `useRef` tracks the most-recently-requested id, and a small pure
`loadXIntelRowIfCurrent` helper (extracted to its own `.ts` file so it's unit-testable without
React/DOM) only applies a response — success OR error — when the id it was fetched for is still
the latest one requested. Deliberately left unchanged: the `?limit=1` query param on the queue
fetch (unrelated to this race; the route evidently ignores it when searching for an id, which is
a separate concern out of scope here) and the per-request fetch strategy itself (re-fetching the
whole limited list and filtering client-side) — only the staleness handling needed fixing.
