## `fetchBangerClosedBoardRows` sorted by entry-time recency, not close-time recency — hid freshly-closed old positions from the member board — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | Night Hawk Swings / Engine B (Banger) — Ask Largo (standing mandate) |
| **Severity** | P2 (member-facing board correctness — a real, just-resolved position was invisible where members look for it) |
| **Files** | `src/lib/banger/positions-db.ts` |

### Root cause

`fetchBangerClosedBoardRows`'s own doc comment says it serves "the member board's 'recently closed'
section", but the SQL sorted `ORDER BY session_date DESC, id DESC` — `session_date` is stamped at
**entry** (commit) time, never updated afterward. So the function's actual behavior was "the most
recently **opened** positions that happen to be closed", not "the most recently **closed**
positions" — those only coincide when a position closes shortly after opening, and diverge hard
for anything that stayed open a long time before finally resolving.

### Evidence

Found while post-deploy-verifying `#5468` (this same session's fix for 41 expired banger positions
stuck OPEN/PARTIAL, oldest 40 days past expiry). Once `#5468` deployed and the `banger-live-sync`
cron ran its first RTH tick (2026-09-23, market open), `fetchBangerOpenCount()` confirmed **45**
rows genuinely transitioned out of `OPEN`/`PARTIAL` (168 → 123 — a real DB write, verified via the
unpaged count, not a display artifact). But none of the previously-identified stuck ids (e.g. FLY
id 99, KTOS id 88 — both entered back in July, contract expired weeks ago) appeared anywhere in
`GET /api/market/banger/board`'s `closed[]` array (60-row window).

Pulled the full 60-row window and printed `id, session_date, closed_at` for each: every visible row
had `session_date` from **2026-09-15 through 2026-09-21** (this week's entries), and `closed_at`
values scattered non-monotonically across the list (e.g. row 1171 closed `2026-09-23T13:30:53Z`
sits near the *bottom* of the 60-row list, while row 1183 — closed back on `2026-09-18` — sits near
the *top*) — direct proof the ordering has nothing to do with closure recency. The 45 freshly-closed
July/August-entered positions all rank below the 60-row cutoff because their `session_date` is
older than every one of this week's entries, regardless of how recently they actually closed.

### Fix

Changed the `ORDER BY` clause from `session_date DESC, id DESC` to `closed_at DESC, id DESC`.
`updateBangerLiveState` already stamps `closed_at = COALESCE(closed_at, NOW())` on every transition
to `CLOSED_RUNNER`/`STOPPED` (both the normal live trailing-stop/hard-stop path and `#5468`'s new
expiry-settlement path go through this same function), so the column is reliably populated for
every closed row — no backfill or migration needed, this is a pure `ORDER BY` change.

### Evidence (tests)

RED→GREEN proven via `git stash` (test file kept, implementation reverted): the new test failed
pre-fix (asserted `ORDER BY closed_at DESC` present and `ORDER BY session_date DESC` absent — the
pre-fix SQL had exactly the opposite), passed post-fix.
`src/lib/banger/positions-db-closed-board-sort.test.ts` (2/2, mock.module()-based SQL-text
assertion, same pattern as the sibling `positions-db-open-book-limit.test.ts`). `tsc --noEmit`:
clean. Full banger-lane suite (`commit`, `contract`, `discord-trade-notify`, `discovery`, `flag`,
`live-sync`, `positions-db*`) + `banger/board/route.test.ts`: all green. Full `npm test`:
15334/15337 pass, 0 fail, 3 pre-existing/unrelated skips.

### Fix rationale

Only one call site (`GET /api/market/banger/board`), so the blast radius of the sort-order change
is contained to that route's `closed[]` array — nothing else reads this function. Kept `id DESC` as
the tiebreak (unchanged) for two rows that close in the exact same instant, rather than inventing a
new tiebreak. Did not add a fallback for a hypothetically-null `closed_at` on a `CLOSED_RUNNER`/
`STOPPED` row: the `updateBangerLiveState` SQL guarantees it is always set the moment a row reaches
either terminal status, so a genuinely-null value there would indicate a *different*, upstream bug
worth its own investigation, not something this fix should silently paper over with a `COALESCE`.
