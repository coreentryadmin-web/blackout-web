> **kind:** FINDING

## 0DTE record: 7 historical rows show `managed_pnl_pct` numerically EXCEEDING `max_favorable_pct` — FIXED

**Status:** Fixed, regression tests added (`src/lib/zerodte/record.test.ts`).

### Root cause

A live audit of `GET /api/market/zerodte/record?days=90` (589 graded plays, 90-day window)
found 7 rows where the as-managed headline (`managed_pnl_pct`) read numerically BETTER than
the position's own recorded maximum favorable excursion (`max_favorable_pct`) — a
mathematical impossibility: a position's realized exit can never beat its own best-ever
recorded moment. All 7 are dated 2026-08-10..2026-08-28 (NVDA 08-28: 0 vs -1.14; OCUL 08-18:
0 vs -1.16; HIMS 08-19: 5.68 vs 5.11; KORU 08-13: -2.5 vs -3.13; SPCH 08-12: 11.63 vs 10.47;
RIOT 08-11: 0 vs -0.54; FIG 08-10: 1.04 vs 0.52); zero such rows in any September/October row
in the same pull.

Both numbers trace to the SAME frozen `entry_context.exit` blob stamped once at commit/exit
time by `buildExitContext` (`src/lib/zerodte/exit-engine.ts`), never rebuilt afterward
(first-write-wins, per `stampZeroDteExitContext`'s documented discipline) — `record.ts`'s
`extractMaxFavorablePct`/`managedGradeView` both read it via `readManagedExit`, and used to
serve `pnl_pct`/`peak_pnl_pct` verbatim with no cross-check between them.

Traced the actual mechanism by reading `buildExitContext`'s pre-2026-09-04 diff
(`f42a3892b`/#3445, "thesis/plan/flat 0DTE exits froze pnl_pct off a cent-rounded mark,
erasing real P&L"): before that fix, for a NON-honored exit (thesis_break/plan_stop/flat
family), `pnl_pct` was computed as `pinnedLivePnlPct(entryPremium, mark)` where `mark` came
from `resolveExitMark`'s `round2(observedMark)` — the raw mid rounded to the nearest cent.
`peak_pnl_pct`, by contrast, was (and still is) always computed from the UNROUNDED
`peakPremium` — `exit-sync.ts`'s `peak = Math.max(row.peak_premium, mark)`, built from the
same raw, pre-rounding mark. Rounding a raw mid that sits just below a half-cent boundary
(e.g. 2.265 -> 2.27) rounds UP past the row's own genuine high-water mark whenever the
premium is cheap enough that a single cent is a meaningful percentage — exactly what the
2026-09-04 fix's own comment warns ("on a sub-$1 lotto premium it can be several points"),
and exactly the 0.5-1.2 point gaps measured on all 7 anomalous rows.

The 2026-09-04 fix (now live for every fresh exit) uses the raw `observedMark` instead of
the cent-rounded one on the non-honored path, so `pnl_pct <= peak_pnl_pct` holds by
construction going forward (confirmed by reading current `buildExitContext` and
`exit-sync.ts`'s `peak = Math.max(row.peak_premium, mark)` guard, both unchanged by this PR)
— but the ~7 rows that already exited under the old formula have the bad number baked into
their immutable `entry_context.exit` blob, and `record.ts` had no read-time correction for
it, unlike the precedent `withRoundedTrailingRuleDisplay` already carries for a different
frozen-blob display bug (the unrounded `trailing_rule` string, fixed 2026-10-26).

### Evidence

- Live audit numbers (operator-supplied, re-derived from the fix's own pre/post diff rather
  than trusted blindly): 7/589 graded rows over a 90-day window, all strictly before the
  2026-09-04 fix shipped (2026-09-03 commit `f42a3892b`), zero after.
- New tests in `record.test.ts` reproduce the exact NVDA (0 vs -1.14, flips win->loss under
  the fix) and HIMS (5.68 vs 5.11, stays a win but the number moves) shapes as bare fixtures,
  plus a no-op test confirming the TSLA shape already in this file (peak=0, realized=-22.57)
  and an ordinary positive-peak ratchet exit (peak=+30%, realized=+22.5%) are both left
  untouched.
- **RED (pre-fix, via `git stash` on `record.ts` only, keeping the new tests):** both repro
  tests failed exactly as expected — `0 !== -1.14` and `5.68 !== 5.11` — 43/45 tests in the
  file still passed (the no-op test, by construction, since no clamp applies to it).
- **GREEN (fix restored):** 45/45 tests in `record.test.ts` pass.
- Full blast-radius re-run: `record.test.ts` + `governor.test.ts` + `calibration.test.ts` +
  `horizon-outcomes.test.ts` + `debrief-aggregate.test.ts` + `analytics-panel.test.ts` +
  `NighthawkAnalyticsPanel.test.ts` + `PlayHistoryTable.test.ts` +
  `grading-policy-consistency.test.ts` — 244/244 pass.
- `npx tsc --noEmit` clean on the whole project.
- Full `npm test` run clean (see PR for the exact pass count on this sandbox's documented
  Node-20 baseline).

### Blast radius

`managedGradeView`'s single "engine" branch (the only place `entry_context.exit.pnl_pct` is
read into the as-managed headline) is the only call site touched. Every consumer of
`asManagedPnlPct`/`buildZeroDteRecord`'s `managed_pnl_pct`/`wins`/`losses`/`avg_pnl_pct`
inherits the corrected number automatically: `scan.ts`'s `grade_vs_asmanaged_delta`
instrumentation, `governor.ts`'s loss-halt realized-P&L read (`ledgerRowRealizedPnlPct`), and
`horizon-outcomes.ts` — all move toward a MORE conservative (lower-magnitude-win /
more-honest-loss) number for the ~7 affected historical rows, never a riskier one, so this
cannot introduce a new risk on the governor's loss-halt path. `extractMaxFavorablePct`
(`max_favorable_pct`) and `officialPlanPnlPct`/`isZeroDteWin`/the calibration+feature-store
lane are all deliberately left untouched — they either are the reliable number the clamp
anchors to, or read a different, independent lane (the executable/mid plan columns) not
affected by this bug at all.

### Fix rationale

Added a read-time-only display clamp, `clampManagedPnlToPeak`, applied exactly where
`managedGradeView` reads the "engine" exit stamp: `pnl = round2(clampManagedPnlToPeak(exit.pnl_pct,
exit.peak_pnl_pct))`. There is no way to recover the TRUE pre-rounding `pnl_pct`
retroactively — the raw, unrounded mark was only ever used transiently to compute it inside
`buildExitContext` and was never itself persisted (only the already-cent-rounded
`mark`/`mark_observed` survive in the frozen blob) — so fabricating a corrected precise
number is not possible. The honest statement available from the data that IS still there is
"this realized at best as well as its own recorded peak," so the clamp caps the displayed
`pnl_pct` at `peak_pnl_pct` (the one number in the same blob the 2026-09-04 bug never
touched — its formula was always `pinnedLivePnlPct(entryPremium, peakPremium)` off the
unrounded peak, before and after that fix).

This mirrors the existing `withRoundedTrailingRuleDisplay` precedent in the same file: a
read-time-only correction for a different frozen-blob display bug, provably a no-op on the
common case (every post-fix row, and every pre-fix HONORED floor/stop exit, which this bug
never touched, already satisfy `pnl <= peak` by construction via `exit-sync.ts`'s own
`peak = Math.max(row.peak_premium, mark)` guard) so it can only ever cap an already-impossible
number, never move a correct one.

Considered and rejected: silently dropping the 7 rows from the record (would understate
`total_flagged`/`graded` and hide real history rather than correct its display); re-deriving
a "true" `pnl_pct` from `mark_observed`/`mark_honored` at read time (the cent-rounding has
already destroyed the precision needed to recover it — `mark_observed` IS the rounded value
the bug came from); fixing it at the source by rewriting the 7 rows' DB blob directly (out of
scope for a reproducible code-level fix, and the whole point of `entry_context`'s
first-write-wins/never-rebuilt discipline across this file is that historical rows are
corrected at READ time, same as `withRoundedTrailingRuleDisplay`).

### Deliberately left unchanged

- `buildExitContext`/`exit-sync.ts` — already correct since the 2026-09-04 fix; re-verified,
  not re-fixed.
- `extractMaxFavorablePct`/`max_favorable_pct` — the reliable number this clamp anchors to.
- `officialPlanPnlPct`/`isZeroDteWin`/the calibration + feature-store lane — a different,
  independent read path (executable/mid plan columns), not affected by this bug.
- The reconstructed (WS-11 trim-scale) and mechanical-fallback (`source: "plan"`) branches of
  `managedGradeView` — neither reads `entry_context.exit.pnl_pct` at all, so neither can carry
  this specific artifact; out of scope for this fix.
