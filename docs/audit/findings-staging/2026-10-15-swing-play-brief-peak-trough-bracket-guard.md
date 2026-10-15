## Ask Largo swing play-brief: Peak can display BELOW the current P&L for a BANGER-origin position — the existing cent-rounding guard's fallback is a no-op when the CANONICAL pnlPct itself is the value out of bounds — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|---|---|

**Root cause.** `pnlSection` (`src/lib/swing/play-brief.ts`) carries a guard (added 2026-10-09,
live CNXC/SG repros) whose stated contract is: "the current mark IS one of the samples peak/trough
were latched from, so the canonical `play.pnlPct` always lies inside [trough, peak] by
construction" — and whose fallback, on a violation, is `pnlForDisplay = play.pnlPct`. That guard
only protects against ONE failure mode: a cent-rounding RECOMPUTE (`Math.round(play.mark*100)/100`)
introducing a NEW violation on top of an otherwise-in-bounds canonical value. Its fallback target
is the canonical `play.pnlPct` itself — so whenever the canonical value is what's ALREADY out of
bounds (no recompute error involved, or the recompute simply reproduces the same canonical number),
the "fallback" reassigns the violating value to itself. Nothing in the function ever widens or
otherwise reconciles `play.peak`/`play.trough` against the P&L actually being shown.

**Evidence.** Live repro, 2026-10-15, SWING:ENOV (positionId 1739, BANGER-origin, status
PARTIAL/TRIM): `GET /api/market/swing/play-brief?playId=SWING:ENOV:1739&ticker=ENOV&positionId=1739&status=OPEN`
rendered, stably across repeated reads several minutes apart (market closed, no new ticks running —
ruling out a mid-tick race):

```
Entry: $0.05
Mark: $0.33 (2026-10-14 16:00 ET)
P&L: +560.0% (open runner only — trim already banked, see below)
Peak: +550.0%
Trough: 0.0%
```

`markRoundTripsPnl` evaluates TRUE for this row (mark $0.33 is a clean, non-cent-ambiguous value —
`Math.round(0.33*100)/100/0.05-1)*100` reproduces `560.0` exactly), so the existing guard's
cent-rounding recompute path never even engages; the violation is already present in the canonical
`play.pnlPct` (560.0) vs `play.peak` (550.0) going in. The existing guard fires (`560.0 > 550.0 +
0.05`) and "falls back" to `play.pnlPct` — i.e. 560.0 again, a no-op.

Cross-checked against the raw ledger row, `GET /api/market/banger/board`: `entry_premium: 0.05,
last_mark: 0.33, peak_premium: 0.33` — the two premiums agree once rounded to the cent that route's
`roundFloats(payload, 2)` call displays at (both round to `$0.33`), but `pnlSection`'s arithmetic
runs on full precision, where a half-cent of raw difference on a nickel-sized entry premium swings
the displayed percentage by a full 10 points (`$0.005 / $0.05 = 10%`). Traced the write path
(`updateBangerLiveState`, `src/lib/banger/positions-db.ts`): its SQL ratchets `peak_premium =
GREATEST(peak_premium, $3)` and `last_mark = $3` in the SAME statement off the SAME bound
parameter, which is provably atomic/self-consistent per write — so this repo's own write path
cannot explain, from read-only production access, which specific tick left `last_mark` ahead of
`peak_premium`'s ratchet for this row; that remains an open question for whoever has raw DB access,
not something this fix guesses at or changes. Reproduced the exact invariant failure with a
git-stash RED→GREEN pair of regression tests in `src/lib/swing/play-brief.test.ts` using these
exact live numbers (and a symmetric synthetic trough case) — both FAIL against the pre-fix code and
PASS after the fix, isolated via `git stash push -u -- src/lib/swing/play-brief.ts` /
`git stash apply` (not the test file).

**Blast radius.** Checked every other rendered consumer of `play.peak`/`play.trough` in this
directory for the same class of defect: `play-brief-intel.ts` and `play-brief-narrative.ts` both
call `mfeCaptureOutcome(play.pnlPct, play.peak, null)` for the "MFE capture" / "gave back the move"
narrative — on the SAME live ENOV data this would compute `capturePct = (560/550)*100 = 101.8%`
rather than show two directly-contradicting numbers side by side the way the Position card's
`P&L:`/`Peak:` lines do; it's a single derived percentage reading slightly over 100%, not an
on-its-face logical contradiction, and the live ENOV brief's own narrative section does not surface
this specific line in this request. Left unchanged — flagging it here for blast-radius completeness
per this file's PR write-up policy, not fixing it, since it's a different section computing a
different (single-number, not directly-contradictory) output and the task this fix addresses is
scoped to the Position card's literal invariant violation. `src/lib/banger/positions-db.ts`'s
ratchet SQL and `insertBangerPosition` were deliberately NOT touched (confirmed correct on paper,
and already the subject of a separate, just-shipped fix today, PR #6027, for the unrelated
insert-time entry-bracket bug) — this fix does not re-open that file.

**Fix rationale.** Widen the DISPLAYED Peak/Trough to bracket the final displayed P&L whenever the
canonical value itself escapes the ledger's own watermark — never the reverse (clamping the P&L
down to a stale Peak would UNDERSTATE the member's real gain, exactly the mistake this file's other
absence/precision guards already exist to avoid). This is the same "widen-only, converge-in-place"
principle `positions-db.ts`'s own entry-bracket fix (PR #6027, same day) already applies to this
identical ratchet pair at the storage layer, applied here at the display layer instead — the task
scope for this fix is `play-brief.ts`, and the exact upstream write-path trigger could not be
confirmed from read-only production access within this fix's scope. Left unchanged: the existing
cent-rounding guard above it (still correct and still needed for the CNXC/SG/EXTR class of bug it
was built for) and every other section of the brief.

**Evidence of no regression.** `npx tsc --noEmit`: clean. `src/lib/swing/play-brief.test.ts`:
135 pass / 0 fail (133 pre-existing + 2 new). Full `npm test` (Node 20, `scripts/run-tests.mjs`):
see companion run-log entry for the exact count.
