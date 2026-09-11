> **kind:** FINDING

## Swing command-deck card could show a "full excursion" trough shallower than the actual realized loss — FIXED

| | |
|---|---|
| **Lane** | Night Hawk Swings — ledger watermarks / command-deck display |
| **File** | `src/lib/db.ts` (`gradeSwingPosition`, `ensureSchema`'s swing-ledger migration block) |
| **Status** | FIXED (this PR) |

### Root cause

`peak_premium`/`trough_premium` are running high/low watermarks of a swing position's option
premium, latched by `updateSwingLiveState` — but that function is only ever called by
`swing-active-refresh`, a cron that runs **15 minutes during RTH only** (`route.ts`'s own header:
"Cron: 15-minute MARK-AND-REVIEW of held SWING positions during RTH"). It therefore cannot capture:

- an overnight/pre-market gap in the underlying (and therefore the option premium), or
- any intrabar move between two 15-minute samples.

`gradeSwingPosition` (the terminal grader that freezes `realized_pnl_pct` and flips a row to
`CLOSED`) never touched `peak_premium`/`trough_premium` at all. So a position's REALIZED exit —
computed independently by the 5-truth grader against real bar data — can land outside the
`[trough, peak]` range the ledger had actually observed, and that range is exactly what the
command-deck card presents to members as **"the full excursion since entry — how much heat you
took and gave back"** (`PlayTerminal.tsx`, rendered for both 0DTE and SWING plays via
`isZeroDtePremiumTerminal`).

This is the same defect class already fixed once for the ENTRY side (FINDINGS 2026-08-06, SEV-2,
"unbracketed watermarks") — that fix bracketed the watermarks around `entry_premium`. It never
covered the EXIT side, because at the time `gradeSwingPosition` didn't exist as a separate write
path from the live latch.

### Evidence

Live pull, 2026-09-11, `GET /api/market/swing/record?days=14` — closedDeck, 6 resolved chains. 4 of
5 losing (`closedReason: "stopped"`, i.e. `realized_pnl_pct < 0`) positions show a realized exit
**worse** than their own tracked trough:

| Ticker | positionId | entryPremium | troughPremium (tracked) | exitPnlPct (realized) | implied exit premium |
|---|---|---|---|---|---|
| AAPL | 36 | 5.90 | 4.10 (-30.5%) | **-56.19%** | ~2.585 |
| MSTR | 33 | 7.28 | 4.00 (-45.1%) | **-61.51%** | ~2.802 |
| CCI  | 31 | 2.03 | 1.43 (-29.6%) | **-35.80%** | ~1.304 |
| IGV  | 28 | 3.90 | 2.68 (-31.3%) | **-39.49%** | ~2.360 |

Each of these implies an exit premium materially below the position's own tracked trough — a
member looking at the CLOSED card's "Trough: -30.5%" (AAPL) next to a realized loss of -56.19%
sees an outcome literally worse than the card's own labeled "full excursion." (INTC and EWZ, the
other two closed chains, did NOT show this pattern — INTC's exit was better than its trough, and
EWZ's target exit was below its peak — both expected/normal shapes.)

None of the 4 affected positions ever crossed the swing scale-out trigger (+100% premium gain;
peak gains were 0-25.7%), so `realized_pnl_pct` on each is a clean single-exit calculation with no
partial-trim blending to complicate the back-calculation of an implied exit premium.

### Fix

1. **`gradeSwingPosition`** (the terminal-grade write): now also brackets `peak_premium`/
   `trough_premium` around the implied exit premium (`entry_premium * (1 + realized_pnl_pct/100)`)
   at grade time — same `GREATEST`/`LEAST` widen-only shape as the existing entry-bracket fix,
   guarded so a grade call with no `realized_pnl_pct` (a bare status flip) or no `entry_premium`
   never touches the watermarks.
2. **`ensureSchema`**: a new one-time backfill (mirroring the existing entry-bracket migration
   exactly) repairs every already-graded row whose watermarks don't yet bracket its realized exit —
   idempotent, no-op once converged, safe to re-run on every boot.
3. **`swingGradeWatermarkBracket`**: a new pure, exported function mirroring both SQL CASE blocks —
   unit-testable without a live Postgres connection (same pattern as `isMonotonicSwingStatusTransition`
   right above it in the file).

### Blast radius

`peak_premium`/`trough_premium` feed the command-deck's "Peak"/"Trough" display (both
`PlayTerminal.tsx` and `ZeroDteCommandPanel.tsx`, shared by 0DTE and SWING via
`isZeroDtePremiumTerminal`) and `closedDeckSourceFromRow`/`closedDeckSourcesFromChains`
(`closed-plays.ts`) for the record API. This fix is SWING-only (`gradeSwingPosition`/
`swing_positions` — the 0DTE equivalent, `updateZeroDteLiveState`, is a different table/function
already covered by its own 2026-08-27 close-freeze fix, not touched here). Never touches
`realized_pnl_pct` itself or any grading verdict — display-only widening of the watermark range.

### Fix rationale

Widening the bracket (rather than, say, re-deriving trough/peak from a full bar-history replay at
grade time) is the minimal fix that matches the already-established, already-reviewed pattern for
the identical problem on the entry side — same discipline, same guarantees (only ever widens,
never narrows a genuinely-ratcheted extreme, no-op once converged).

### Evidence of testing

New pure-function tests in `db-swing-ledger.test.ts` (`swingGradeWatermarkBracket`: widens trough
for a worse-than-tracked loss, widens peak for a better-than-tracked win, never narrows an
already-bracketing exit, never fabricates without an entry premium or a grade, seeds from entry
when never latched at all) + a source-inspection test confirming `gradeSwingPosition`'s SQL carries
the same widen-only CASE shape. RED→GREEN proven via `git stash` (6 new tests fail without the
`db.ts` changes, all pass with them restored). Full `db-swing-ledger.test.ts` (33 tests) and
`db.test.ts` (30 tests, including the existing "SEV-1 no SQL param's first occurrence is an
untyped IS NULL" guard and the entry-bracket migration test) both pass with no regressions.
`npx tsc --noEmit`: clean. Full `npm test` (Node 20): run alongside this fix.
