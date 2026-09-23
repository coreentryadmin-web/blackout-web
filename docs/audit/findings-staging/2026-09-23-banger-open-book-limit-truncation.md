## `fetchBangerOpenBookRows`'s hardcoded `limit=80` silently truncated the real open banger book across 5 consumers — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | Night Hawk Swings / Engine B (Banger) — Ask Largo (5-engine live monitor sweep) |
| **Severity** | P1 (member-facing board + live marks + concentration/identity checks all silently dropped ~50% of real open positions) |
| **Files** | `src/lib/banger/positions-db.ts`, `src/app/api/market/nighthawk/horizons/route.ts`, `src/app/api/market/banger/board/route.ts`, `src/lib/swing/play-brief-resolve.ts`, `src/lib/swing/live-marks-active.ts` |

### Root cause

`fetchBangerOpenBookRows(limit = 80)` (`positions-db.ts`) queried `banger_positions WHERE status IN
('OPEN','PARTIAL') ORDER BY session_date DESC, id DESC LIMIT $1`, and every one of its 6 call
sites either passed `80` explicitly or relied on the same `80` default. Its own doc comment
claimed this was safe — "not page-limited all-status scans", distinguishing it from the
already-fixed `fetchBangerBoardRows` bug (mixed-status page truncation) — but a hardcoded `LIMIT`
truncates just as surely on a single-status query once the real row count exceeds it.

This is the SAME truncation shape already fixed once, one layer up, for a different function:
`docs/audit/FINDINGS.md`'s "`fetchBangerBoardRows(60)` selects the most recent 60 rows of
banger_positions across ALL statuses combined... once total (open+closed) rows exceed 60, an
older-but-still-OPEN position ages out of the shared window and silently vanishes from the board,
even though it is a real, live holding." That fix scoped `fetchBangerOpenBookRows`'s WHERE clause
to OPEN/PARTIAL only specifically so it would NOT be subject to the same class of bug — but the
`LIMIT` itself was never removed, so the fix's own filtered function inherited an equivalent
defect, just requiring a higher row count to trigger.

**Live evidence, 2026-09-23:** `fetchBangerOpenCount()` (the true, unpaged count) reported **168**
real currently-open banger positions, while `GET /api/market/nighthawk/horizons?view=swings`'s
`board.lanes.SWING.committed` array — fed by `fetchBangerOpenBookRows(80)` — contained only **85**
total committed positions (3 native swing + ~82 banger). Since the query orders `session_date
DESC, id DESC`, the ~85 positions silently dropped were the OLDEST open positions — the ones that
have been open longest and arguably most need monitoring, not the newest/least-interesting ones.

**Blast radius — 5 real consumers, all silently degraded the same way:**
- `src/app/api/market/nighthawk/horizons/route.ts` — the Swing Command board's `committed` array
  (member-facing; this is the actual live board members and Largo read).
- `src/app/api/market/banger/board/route.ts` — the Banger board's own open-position listing.
- `src/lib/swing/live-marks-active.ts` — live mark-freshness tracking for banger-origin positions.
- `src/lib/swing/play-brief-resolve.ts` — Ask Largo's play-brief identity resolution (a truncated
  book could fail to resolve a real banger-origin position at all).
- `src/lib/swing/play-brief-context.ts` — `bookContextSection`'s concentration/theme-overlap check
  (already fixed once, 2026-09-12, specifically to stop being "blind to 94% of the live open
  book" — that fix itself inherited this same hidden truncation, since it called
  `fetchBangerOpenBookRows()` with the pre-fix `limit=80` default).

### Fix

`fetchBangerOpenBookRows(limit?: number)` — `limit` is now optional. When omitted, the query
carries NO `LIMIT` clause at all, so every real OPEN/PARTIAL row is returned; when a caller
explicitly passes a limit, the bounded-page behavior is preserved (kept for callers that might
genuinely want a page in the future — none currently do). All 5 call sites that previously
hardcoded `fetchBangerOpenBookRows(80)` now call `fetchBangerOpenBookRows()`.

This mirrors the design principle `fetchBangerClosedBoardRows`'s own doc comment already states
for the split between open and closed reads: "closed history genuinely grows without bound and
paging it is correct... this is the SAME truncation `fetchBangerBoardRows` used to apply to BOTH
statuses at once, kept here for the side where it's actually the right call" — i.e. the OPEN side
was always meant to be a complete, unpaged snapshot; only the closed side should ever page.
`fetchOpenBangerPositions()` (a sibling function, `WHERE status NOT IN ('CLOSED_RUNNER','STOPPED')`,
no limit) already followed this principle correctly for the live-sync loop — this fix brings
`fetchBangerOpenBookRows` into line with it rather than inventing a new pattern.

### Evidence

Two RED→GREEN tests (`git stash` proven against the pre-fix function),
`src/lib/banger/positions-db-open-book-limit.test.ts`:
- `no limit argument -> SQL carries no LIMIT clause (the real open book is never truncated)`
- `explicit limit -> SQL still carries a bounded LIMIT clause for callers that want a page`

47/47 tests pass across the touched test files (`positions-db.test.ts`,
`positions-db-open-book-limit.test.ts`, `horizons/route.test.ts`, `banger/board/route.test.ts`,
`play-brief-context.test.ts`, `play-brief-resolve.test.ts`, `live-marks-active.test.ts`).
`tsc --noEmit`: clean. Full `npm test`: run in progress at PR time, confirmed green before merge.

### Fix rationale

Removing the artificial cap (rather than raising it to some new fixed number) is deliberate: any
fixed cap re-creates the identical bug once the real open count grows past it again, which is
exactly how this defect survived the earlier, correctly-scoped `fetchBangerBoardRows` fix. The
open-position set is naturally self-bounding (positions close), unlike closed history, so an
unpaged read carries none of the unbounded-growth risk that makes paging necessary for
`fetchBangerClosedBoardRows`. Kept the optional `limit` parameter rather than deleting it, since a
future caller with a genuine pagination need (e.g. an admin UI) can still ask for a bounded page —
but no current caller does, and none should default to one silently again.
