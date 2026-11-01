> **kind:** FINDING

## AdminApiLiveFeed grouping picked the OLDEST occurrence as a repeated incident's representative — FIXED

| | |
|---|---|
| **Area** | Admin command center — `src/components/admin/AdminApiLiveFeed.tsx` |
| **Severity** | P3 (admin-facing display defect, not a crash/outage) |
| **Status** | FIXED (PR, this branch) |

### Root cause

`groupErrors(events)` folds a whole batch of events into de-duplicated `FeedGroup`s via
`events.reduce((acc, event) => pushGrouped(acc, event), [])`. The server's `recent_errors`/
`recent_events` snapshot (`getApiTelemetrySnapshot` in `src/lib/api-telemetry.ts`) is always
**newest-first** — the underlying `events` array is built with `events.unshift(event)` — and the
live SSE `"snapshot"` message (`AdminApiLiveFeed.tsx`'s own `es.onmessage` handler) folds in the
same newest-first `data.recent_errors` array the same way.

`Array.reduce` visits `events[0]` (the newest) first and the last element (the oldest) last. The
old `pushGrouped` always set the group's representative `event` field to whichever event it was
just called with, with no comparison to what was already there:

```ts
if (idx > 0) {
  const merged = { key, event, count: prev[idx].count + 1 }; // `event` = whatever was just passed in
  ...
}
```

So for an incident key appearing twice in one newest-first batch, the SECOND time it was folded
in — which, because the batch is newest-first, is chronologically the OLDER occurrence — silently
overwrote the group's displayed `event` with the older one's fields: its `error` text, `severity`,
`attempt`/`max_attempts`, and the `at` timestamp that `timeAgoFromIso` reads for the "time ago"
badge shown in the feed row. The group still correctly bumped to the front of the list and its
`count` incremented correctly — only the representative content was wrong, understating how
recently the incident last fired and potentially showing stale error detail under a
correct-looking fresh position.

### Fix

`pushGrouped` now compares `seq_id` (`ApiCallEvent.seq_id`, a strictly increasing per-event
counter assigned at creation in `api-telemetry.ts` — immune to array fold order, unlike comparing
ISO timestamp strings) and always keeps the event with the higher `seq_id` as the group's
representative, regardless of which order `pushGrouped` is called in. This is correct for:
- the batch-fold path (`groupErrors`, the bug above), and
- the live single-event SSE push path (`es.onmessage`'s `data.type === "event"` handler), where
  the incoming event is always the newest and the seq_id comparison is a no-op (no behavior
  change there).

`pushGrouped`, `groupErrors`, and the `FeedGroup` type are now exported so the fold-order bug is
unit-testable without rendering the component (same pattern as `AdminApiEventDetail.tsx`'s
`loadEventDetailIfCurrent`).

### Evidence (RED → GREEN)

New test file `src/components/admin/AdminApiLiveFeed-group-representative.test.ts`, 3 cases.
Reverted `pushGrouped` to the old "just overwrite with whatever was passed in" logic:

```
not ok 1 - groupErrors: folding a NEWEST-FIRST batch keeps the NEWER occurrence as the group's representative event
  actual: group.event.id === 'old'   # the stale occurrence won, reproducing the bug
not ok 3 - pushGrouped: an out-of-order call with an OLDER seq_id never regresses an already-newer representative
```

Restored the fix: all 3 pass. Full `src/components/admin/*.test.ts(x)` directory (71 tests)
passes; `tsc --noEmit` clean.

### Blast radius

`pushGrouped` has exactly one call site family: `groupErrors` (batch fold, on `initialErrors`
prop change and on the SSE `"snapshot"` message) and the direct single-event SSE push
(`data.type === "event"`) — both covered by the tests above. No other component imports from
this file.
