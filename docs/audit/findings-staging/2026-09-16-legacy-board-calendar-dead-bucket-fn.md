## 2026-09-16 — [FINDING, FIXED] Dead placeholder `legacyEditionCalendarBuckets` removed from legacy-board-calendar.ts

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 — dead code, zero runtime impact, but a real name-collision footgun |
| **Lane** | Night Hawk Legacy |
| **PR** | fix/legacy-board-calendar-dead-bucket-fn |

### Root cause

`legacyEditionCalendarBuckets` (`legacy-board-calendar.ts`) was written as an always-zero PnL
placeholder — its own doc comment says so verbatim: "Calendar buckets for edition browsing — PnL
fields are placeholders until record overlay lands." The record overlay it was waiting for did
land, but as a differently-named, fully real, actively-maintained sibling instead:
`legacyBoardCalendarBuckets` (note: "Board", not "Edition") in `legacy-board-table-utils.ts` — the
one actually wired into `LegacyPickLogBoard.tsx`, computing real per-day win/loss/net-premium
buckets from live record rows (with its own documented bug-fix history: excluding
never-entered-pull rows from the blended average, handling stock-only null premiums honestly).

The old placeholder was simply never deleted once its replacement shipped under a different name.

### Evidence

Repo-wide grep: `legacyEditionCalendarBuckets` had **zero callers anywhere in the app** and **zero
test coverage** (not referenced in its own file's test suite, `legacy-board-calendar.test.ts`,
which only exercises the file's other export, `legacyEditionSessionDates`). Confirmed the real,
wired-up implementation is `legacyBoardCalendarBuckets` (`legacy-board-table-utils.ts:174`), used
by `LegacyPickLogBoard.tsx` via `useMemo(() => legacyBoardCalendarBuckets(allRows, calendarDates), ...)`.

### Fix rationale

Not a correctness bug (nothing calls the dead function, so it changes no live behavior), but a
real hazard: the two names differ by one word ("Edition" vs "Board") and share an identical
purpose description, making it easy for a future reader or a search to wire up the wrong one and
silently ship an always-zero PnL calendar strip. Deleted per CLAUDE.md's standing guidance —
"if you are certain something is unused, you can delete it completely" — rather than left to rot.

### Blast radius

None — confirmed zero real callers before deleting. `VectorBoardCalendarBucket` (the dead
function's return-type import) also removed since it becomes unused.

### Tests

Added a source-level regression asserting the dead export and its now-unused type import are both
gone. RED confirmed pre-fix (fails against the original file via `git stash`), GREEN confirmed
post-fix. `tsc --noEmit` clean (no broken references to the deleted export anywhere in the
codebase). Full suite run in progress.
