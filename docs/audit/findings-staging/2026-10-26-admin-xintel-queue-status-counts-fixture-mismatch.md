> **kind:** `FINDING`

## Admin X intel queue status chips contradicted the fixture cards they sat above — FIXED

**Status.** FIXED (PR #6792).

### Area

`src/components/admin/AdminXIntelQueuePanel.tsx` — the Admin console's "X intel queue" tab
(non-owned). Backed by `src/lib/x-intel/queue-fixtures-gate.ts`'s `shouldShowXIntelFixtures` and
`src/lib/x-intel/queue-fixtures.ts`'s `X_INTEL_QUEUE_FIXTURES`.

### Found by

Code-correctness read, DISCOVERY-lane sweep, 2026-10-26.

### Root cause

The status chip bar ("ready N · review N · skip N") and the cards rendered directly below it read
from two different arrays. `counts` was computed via `const src = rows ?? []` — the raw API
response — while the rendered cards used `display = showFixtures ? X_INTEL_QUEUE_FIXTURES :
(rows ?? [])`. `shouldShowXIntelFixtures` returns `true` whenever the real queue is genuinely
empty under the `ALL` filter — an ordinary, expected state before the X-intel generator has ever
produced a row. In that exact state the chip bar read `ready 0 · review 0 · skip 0` while the four
hand-written fixture cards (2 READY, 1 REVIEW, 1 SKIP) rendered immediately underneath with their
own real status badges — a direct, user-visible contradiction on the same panel.

### Fix

Extracted `computeXIntelStatusCounts(display)` (`src/lib/x-intel/queue-status-counts.ts`) and
counted over `display` — the exact array actually rendered — instead of `rows`. No behavior
change once the queue has real data; only the empty/fixture state is affected.

### Blast radius

`counts` had no other consumers; `AdminXIntelQueuePanel` is the sole caller of the new helper. No
change to `shouldShowXIntelFixtures`, `X_INTEL_QUEUE_FIXTURES`, or any API route.

### Tests

3 new unit tests in `queue-status-counts.test.ts` (fixture-mix match, never-all-zero-with-rows,
genuinely-zero-when-empty). RED→GREEN via `git stash` on the two source files. `tsc --noEmit`
clean. Full suite: 17002 pass / 0 fail / 3 pre-existing skips (unrelated).
