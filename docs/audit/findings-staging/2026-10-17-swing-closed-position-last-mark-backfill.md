> **kind:** FINDING

## Pre-#6109 closed Swing positions permanently showed a `last_mark` contradicting their own P&L% — FIXED (one-time backfill)

| **Status** | FIXED |
|---|---|
| **Severity** | P2 |
| **Area** | Night Hawk Swings ledger — `src/lib/db.ts`, `ensureSchema()` (boot-time converge-in-place backfill) |
| **Found by** | Ask Largo × Night Hawk Swings standing mandate, post-merge verification cycle (independent background re-check of PR #6109) |

### Root cause / background

PR #6109 (merged earlier this session) added an `exit_mark` parameter to `gradeSwingPosition()` so
the grading tick's own mark latches onto `last_mark`/`last_mark_at` — this guarantees a closed row's
`contract.mid` (`closed-plays.ts:198`, `mid: row.last_mark`) can never again disagree with its own
`exitPnlPct`. That guard only protects rows graded **after** it shipped.

Every row graded before it is left with an unrepaired historical mismatch: `last_mark` is whatever
the last live 15-minute RTH latch happened to catch before the position closed, which has nothing to
do with the real exit fill (the mechanical trough/peak-bracketed stop/target price
`realized_pnl_pct` is actually computed from). `PlayTerminal.tsx` labels this field "Live mark"
directly beside the correct P&L% badge — on a CLOSED card the two visibly contradict each other.

Live-verified 2026-10-17 across the then-current 19-row closed deck (100% of the population showed
the mismatch): BE entry 17.95, last_mark 36.65 (implies +104.2%) vs. real exitPnlPct +70.61% (33.6pp
gap); INTC entry 4.72, last_mark 3.00 (implies −36.4%) vs. real −73.12% (36.7pp gap); TSLA entry
15.95, last_mark 11.78 (implies −26.1%) vs. real −32.76%.

### Fix

Added a one-time, converge-in-place backfill to `ensureSchema()` (runs automatically on every ECS
boot, same mechanism as the three pre-existing peak/trough-premium backfills already in this exact
function for the identical "historical rows predate a grade-time fix" shape — `FINDINGS 2026-08-06`/
`2026-09-11`/`2026-10-15`):

```sql
UPDATE swing_positions
   SET last_mark = entry_premium * (1 + realized_pnl_pct / 100.0),
       last_mark_at = graded_at
 WHERE status IN ('CLOSED', 'ROLLED')
   AND entry_premium IS NOT NULL
   AND entry_premium > 0
   AND realized_pnl_pct IS NOT NULL
   AND graded_at IS NOT NULL
   AND ABS(COALESCE(last_mark, 0) - entry_premium * (1 + realized_pnl_pct / 100.0)) > 0.01;
```

- The corrected value is the exact inverse of the formula `gradeParentFromMark` (roll-plan.ts)
  already uses to derive `realized_pnl_pct` from a mark (`realized = ((mark − entry) / entry) * 100`),
  so this is a faithful reconstruction, not an approximation.
- `last_mark_at` is unconditionally backdated to `graded_at` (when the corrected value was actually
  established) — never `NOW()`, and never left at the stale pre-close live-latch timestamp, which
  would otherwise leave a corrected mark sitting beside a timestamp that still describes the old,
  wrong one.
- The `> 0.01` tolerance keeps this a no-op past ordinary float/rounding noise, same discipline as
  the sibling peak/trough backfills; safe and cheap to re-run on every boot.
- Scoped to `CLOSED`/`ROLLED` only — never touches an OPEN position's live mark. `ROLLED` is
  included because a rolled PARENT leg's grade freeze (`gradeParentFromMark`) latches the identical
  entry/mark/realized_pnl_pct triple through the same `gradeSwingPosition` call, so a rolled parent
  graded before the fix carries the identical mismatch, even though it never reaches the member-facing
  closed deck directly (`closedDeckSourceFromRow` gates on `status === 'CLOSED'`).
- Never fabricates: a row missing `entry_premium`/`realized_pnl_pct`/`graded_at` has nothing to
  correct against and is left entirely alone.

Unlike the peak/trough backfills (which only ever WIDEN a range via GREATEST/LEAST, safe in any
direction), this one REPLACES a single point value outright — called out explicitly in-code since
it's the one place this migration departs from the established widen-only precedent it otherwise
follows exactly.

### Evidence

New regression test (`src/lib/db-swing-ledger.test.ts`) confirmed RED against the unmodified source
(`git stash` of the source fix alone) — failed with the backfill statement entirely absent — then
GREEN restored. Pinned by source inspection, same idiom as every other `ensureSchema` backfill test
in this file (no live Postgres in CI). Full `db-swing-ledger.test.ts` + `db.test.ts` (76 tests) and
`tsc --noEmit` both clean.

### Blast radius

Single table (`swing_positions`), single column pair (`last_mark`/`last_mark_at`), applied only to
already-terminal (`CLOSED`/`ROLLED`) rows. No other table carries the same `exit_mark`-latch gap —
`zerodte_setup_log`/`banger_positions` have their own, separately-fixed peak/trough watermark
backfills but neither has an equivalent "mark vs. realized P&L" grading field of this shape.
