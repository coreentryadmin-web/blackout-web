## Ask Largo / Night Hawk Swings: `GET /api/market/swing/record`'s `closedDeck` silently dropped a position that closed TODAY if it was entered before the `days` window — "what closed today" returned nothing despite a real closed position

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #TBD) |
| **Found by** | Live-production audit agent, Ask Largo × Night Hawk Swings standing ownership mandate, 2026-10-26 |
| **Scope** | `src/lib/db.ts` (new `fetchRecentlyClosedSwingPositions`), `src/app/api/market/swing/record/route.ts` |

### Root cause

This is the CLOSED-side sibling of the 2026-10-25 fix already in this file's history for the
OPEN-side gap ("`fetchSwingPositionsRange` filters on `session_date >= since` — a currently
OPEN/HOLD/TRIM position whose own session_date (entry date) predates the window is invisible to
that query"). That fix rescued OPEN positions by unioning in `fetchOpenSwingPositions()`'s rows
(unbounded by date, status-filtered to live statuses) — but a position that has since **closed**
falls through BOTH queries: `fetchSwingPositionsRange` still excludes it if its entry predates
`since`, and `fetchOpenSwingPositions()` can no longer rescue it because it is no longer
OPEN/HOLD/TRIM.

`swing_positions` carries a real `closed_at TIMESTAMPTZ` column, stamped together with
`graded_at` at close time (`UPDATE swing_positions SET closed_at = COALESCE(closed_at, NOW()),
graded_at = NOW() ...`, `src/lib/db.ts`), but nothing in the `/record` route's root-seeding path
ever queried on it — `fetchSwingPositionsRange`/`fetchClosedSwingPositionsRange` both filter on
`session_date` (ENTRY date), never `closed_at`. "Did this position close recently" is a
present-tense fact about the CLOSE, not a historical fact bounded by how long before `since` the
position happened to be ENTERED — the exact same misdiagnosis the 2026-10-25 fix already
corrected for "is this position currently open," just on the other side of the lifecycle.

### Evidence

Live `GET /api/market/nighthawk/horizons?view=swings` showed the native swing committed lane
drop from 93→85 positions between 12:55–13:15 UTC on 2026-10-26, with zero corresponding entries
in `GET /api/market/swing/record?days=2`'s `closedDeck` (0 rows) — initially (correctly) traced to
Banger-engine-side closes for most of the drop, but one native swing position, MRNA (positionId
65, LONG EVENT_DRIVEN), was also among the morning's real closes and was *not* a Banger position.

Direct reproduction: `GET /api/market/swing/record?days=1/2/3` (window `since` 2026-10-23..25,
`through` 2026-10-26) all returned `closedDeck.length: 0` and no MRNA row anywhere in the payload.
`GET /api/market/swing/record?days=5` (window `since` 2026-10-21, which happens to predate MRNA's
own 2026-10-22 entry) suddenly returned 3 closedDeck rows including MRNA:
`{positionId:65, ticker:"MRNA", status:"CLOSED", exitAt:"2026-10-26T13:46:15.000Z",
exitPnlPct:-34.47, closedReason:"stopped"}` — a real, same-day stop-out that a member or Largo
asking "what closed today" (the natural `?days=1` query) via the same endpoint would have seen
nothing for.

Reproduced locally with a regression test
(`src/app/api/market/swing/record/route.test.ts`): a fixture row entered `2026-10-22` (CLOSED,
`closed_at: 2026-10-26T13:46:15Z`) injected only via the new `fetchRecentlyClosedSwingPositions`
mock — confirmed RED via `git stash` of the two source files (test kept in place): `?days=1`
returned an empty `closedDeck`. GREEN after applying the fix.

### Fix

Added `fetchRecentlyClosedSwingPositions(sinceDate, limit)` (`src/lib/db.ts`) — the CLOSED-side
mirror of `fetchOpenSwingPositions()`: `SELECT * FROM swing_positions WHERE status IN
('CLOSED','ROLLED') AND closed_at >= $1::date ORDER BY closed_at DESC, id DESC LIMIT $2`, filtered
on the column that actually answers "did this close in the window," unbounded by entry date. Wired
into the route (`src/app/api/market/swing/record/route.ts`) as a third union into `rootIds`,
alongside the existing `rows`/`openRows` unions, fail-soft to `[]` on a DB hiccup matching this
route's existing per-source discipline. `selectSwingRecordRootIds` already picks up a CLOSED row
correctly once it ever sees it (it keys on `graded_at`, which is always set together with
`closed_at`) — the gap was entirely upstream, in which rows got handed to it, exactly like the
2026-10-25 fix.

Deliberately left unchanged: `fetchSwingPositionsRange`/`fetchClosedSwingPositionsRange`'s own
`session_date`-filtered semantics, since other real callers (the calibration harness, the
multi-truth-grade retrace) depend on entry-date windowing specifically — this fix adds a new,
narrowly-scoped accessor rather than widening an existing one's contract.

### Regression test

`src/app/api/market/swing/record/route.test.ts`: *"a position that CLOSED inside the days window
but was ENTERED before it still appears in closedDeck (2026-10-26, Ask Largo standing mandate,
live repro MRNA#65)"* — fixture position entered 2026-10-22, closed 2026-10-26, queried under
`?days=1`; asserts the row is present in the served `closedDeck`.

### Verification

- `npx tsx --experimental-test-module-mocks --test src/app/api/market/swing/record/route.test.ts` —
  RED pre-fix (4 pass / 1 fail, `git stash` of `db.ts`+`route.ts` with the test kept in place),
  GREEN post-fix (5 pass / 0 fail).
- `npx tsx --experimental-test-module-mocks --test src/app/api/market/swing/record/route.test.ts src/lib/swing/record.test.ts src/lib/swing/closed-plays.test.ts src/lib/db.test.ts` — 94/94 pass.
- Full suite (`npm test`, Node 20) — pass, 0 fail.
- `npx tsc --noEmit` (Node 20) — clean, exit 0.
