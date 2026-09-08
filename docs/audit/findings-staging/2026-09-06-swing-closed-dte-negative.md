> **kind:** `FINDING`

## Closed swing plays served a live-recomputed (negative/nonsensical) DTE instead of a frozen trade-lifecycle value — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P2 (HIGH per source audit — data-correctness, member-facing, no financial-risk blast radius) |
| **Area** | Night Hawk Swings — `closed-plays.ts` / CLOSED deck / Ask Largo play-brief headline |
| **PR** | (pending) |

### Symptom

A CLOSED swing position's rendered contract label (`"${strike}${right} · ${dte}DTE"`) showed a
DTE number computed against **today's date**, not the trade's own lifecycle — so it silently
changed every time the record was re-viewed, and went **negative** once the contract itself
expired. Live production evidence (captured 2026-09-06 by `docs/audit/SWING-SYSTEM-CTO-AUDIT-2026-09-06.md`
finding #16): `EWZ expiry 2026-09-04 dte -2` and `GLW expiry 2026-09-04 dte -2` (both already
expired as of the request date). A graded AAPL row (true DTE at entry 6, at exit 5) showed
`dte: 3` — neither true value, just "days from right now until expiry." The Ask Largo play-brief
headline for that same position rendered `STOPPED — AAPL 327.5C 3DTE` to the member reviewing a
finished trade.

### Root cause

`closedDeckSourceFromRow` (`src/lib/swing/closed-plays.ts`, pre-fix line 66):
```ts
const dte = calendarDte(etYmd(), expiry.slice(0, 10));
```
`etYmd()` is **today's** ET calendar date — the moment the record is being *read*, not any moment
in the trade's own lifecycle. For a CLOSED, already-graded position this is simply the wrong
input: "days until expiry from now" is meaningless (and eventually negative) for a trade that has
already exited. The swing ledger (`swing_positions` — grepped `src/lib/db.ts`, confirmed via
`SwingPositionRow`) carries no dedicated `dte_at_entry`/`dte_at_exit` column, so this
live-recomputed number was the *only* DTE the schema ever served for a closed trade — verified this
is still true against current `main` (2026-09-06), i.e. the audit's description holds unchanged;
no other session's fix touched this file first.

Confirmed the OPEN/HOLD/TRIM path is intentionally different and correctly untouched:
`src/lib/swing/live-plays.ts`'s `contractFromRow` computes the identical
`calendarDte(etYmd(), expiry)` for a still-**live** position, where "DTE as of right now" genuinely
is the number a member needs (how long until this open contract itself expires). The bug is
specific to reusing that same "now"-anchored formula for a position that is no longer live.

### Evidence

`git grep -n "closedDeckSourceFromRow" src` shows the CLOSED path is exercised from two entry
points, both of which reach the member:
1. `src/app/api/market/swing/record/route.ts` (via `closedDeckSourcesFromChains` →
   `closedDeckSourceFromRow`) — the `/api/market/swing/record` CLOSED-tab array.
2. `src/lib/swing/play-brief-resolve.ts`'s `loadClosedPlay` (called from
   `resolveSwingPlayForBrief`, which `play-brief-context.ts`'s `loadSwingPlayBriefContext` calls,
   which `src/app/api/market/swing/play-brief/route.ts`'s `GET` handler calls directly) — the Ask
   Largo play-brief headline/contract string for a CLOSED play, reached via
   `?playId=SWING:<TICKER>&positionId=<id>` with no `status` filter required, so a closed
   position's brief is a live, reachable code path today, not a hypothetical one.

Both consumers format the number through
`src/features/nighthawk/command-deck/adapters.ts:897`'s
`` contract: `${src.contract.strike}${src.contract.right} · ${src.contract.dte}DTE` `` inside
`terminalPlayFromHorizon`, called by `terminalPlayFromClosedSwing` for the CLOSED shape — one
formatting call site, fed by the one broken `dte` computation.

RED→GREEN reproduced directly with `node --import tsx --test src/lib/swing/closed-plays.test.ts`
(git-stashed the fix to prove RED): pre-fix, a fixture row with `expiry: "2026-08-15"`,
`closed_at: "2026-08-10T16:00:00Z"` graded against a "now" run months later reported `dte: -22`
(nonsensical — the fixture's own exit was 5 days before expiry, not -22); post-fix it reports the
frozen `dte: 5`. A second case reproduces the exact live EWZ/GLW shape (expiry == closed_at date,
i.e. the contract expired the session it closed) and asserts `dte: 0` forever, rather than a
number that goes more negative every day the record is later viewed.

### Blast radius

- `src/lib/swing/closed-plays.ts` — `closedDeckSourceFromRow` (root cause) and its one caller
  inside the same file, `closedDeckSourcesFromChains` (no separate defect there — it delegates to
  the fixed function per-row, so the chain-composite CLOSED-deck list view is fixed transitively).
- `src/app/api/market/swing/record/route.ts` — CLOSED tab array, fixed transitively (route itself
  unchanged).
- `src/app/api/market/swing/play-brief/route.ts` → `play-brief-resolve.ts`'s `loadClosedPlay` —
  Ask Largo headline/contract string for a CLOSED position, fixed transitively.
- `src/lib/swing/record.ts` (named by the source audit) — read-only re-check: it does not itself
  compute `dte` anywhere; it consumes `closedDeckSourceFromRow`'s already-fixed output via
  `buildSwingRecord`/composite grading, so no separate change was needed there.
- **Explicitly NOT touched**: `src/lib/swing/live-plays.ts`'s `contractFromRow` — the live
  OPEN/HOLD/TRIM DTE computation is a different, correct use of "now," per the fix rationale below.

### Fix

`closedDeckSourceFromRow` now computes the exit timestamp first —
`const exitAt = row.closed_at ?? row.graded_at` (both already-populated ledger columns; `graded_at`
is guaranteed non-null by the function's own early-return guard, so `exitAt` is always a real
timestamp for any row that reaches this line) — and derives `dte` from it:
`calendarDte(exitAt.slice(0, 10), expiry.slice(0, 10))`, i.e. "days to expiry as of the day this
trade actually closed." This value is fixed by the row's own history and cannot change on re-view,
and reads `0` (not negative) for a contract that expired the same session it closed. The
already-existing `exitAt` field on `SwingClosedDeckSource` (previously computed a second time,
redundantly, a few lines later) now reuses the same variable instead of recomputing it twice.

**Why this fix and not a schema migration:** the audit's suggested fix proposed persisting a
dedicated `dte_at_entry`/`dte_at_exit` column on `swing_positions` at write time. That is a valid
longer-term option but a strictly larger, riskier change (new column, backfill-or-null story for
already-closed historical rows, a write-path change to `commit.ts`/`record.ts`) for the same
observable member-facing outcome. The ledger already carries `closed_at`/`graded_at` for every row
this function can return (`row.graded_at` is required non-null by the function's own guard), so
deriving DTE from the existing exit timestamp gets the identical honest, frozen number with a
one-file, no-migration change and zero new nullable-history-backfill surface. If a genuine
DTE-at-**entry** view (as opposed to at-exit) is wanted later, that remains a clean follow-up
against `committed_at`/`first_seen_at`, which the row also already carries.

### Test

`src/lib/swing/closed-plays.test.ts`: three new cases under `describe("closedDeckSourceFromRow")`:
- "freezes dte to the trade's own exit date, never recomputed against today" — RED pre-fix (dte
  drifts arbitrarily negative depending on when the suite runs), GREEN post-fix (`dte: 5`, fixed).
- "still reports a sane frozen dte for an already-expired contract (EWZ/GLW shape)" — expiry ==
  closed_at date; asserts `dte: 0` forever.
- "falls back to graded_at when closed_at is absent" — legacy-row shape, asserts both the frozen
  `dte` and that `exitAt` on the returned source matches `graded_at`.

RED→GREEN proof: `git stash push -- src/lib/swing/closed-plays.ts` (keeping the new test file),
ran `npx tsx --test src/lib/swing/closed-plays.test.ts` on Node 20 → **3 of 6 fail** (the new
cases, `-22 !== 3` for the fallback case), confirming the bug reproduces on unmodified `main`;
`git stash pop` restored the fix → **6/6 pass**. Full `src/lib/swing/*.test.ts` suite: 632/633 pass
(the one failure, `play-brief-resolve.test.ts`, fails identically with and without this change —
`TypeError: import_node_test2.mock.module is not a function`, a pre-existing Node-flag requirement
unrelated to this fix, reproduced on unmodified `main` via `git stash` before concluding so).
`npx tsc --noEmit`: clean.
