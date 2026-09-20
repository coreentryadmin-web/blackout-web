> **kind:** FINDING

## Night Hawk Swings — Q37 roll-execution re-check bypassed the Q39 ex-dividend structural-stop adjustment — FIXED

| | |
|---|---|
| **Lane** | Night Hawk Swings — position management / roll executor |
| **Severity** | P1 (capital-preservation path, live/reachable) |
| **Status** | FIXED — `src/lib/swing/manage-sync.ts` |
| **Found by** | Ask Largo × Night Hawk Swings standing ownership mandate (CLAUDE.md), 2026-09-20 |

### Root cause

`manage-sync.ts`'s `executionVerdictForGating` ("Q37") re-arbitrates a roll plan immediately
before execution: it re-checks whether the underlying has broken its structural stop, and if
so, forces the verdict to `structural_stop`/`EXIT` — CLOSE wins over ROLL. This exists because a
concurrent refresh pass or a slow contract-selection fetch can leave a roll plan built against a
now-stale structural read.

The bug: this re-check called `structuralBreakFromSpot(direction, reads.underlyingPrice, row.thesis_invalidation_px)`
directly — a RAW spot-vs-stop compare with no ex-dividend adjustment. But the *original* verdict
(built earlier in the same tick by `manage.ts`'s `structuralStopBroken`, called from
`evaluateSwingManagement` inside `planManageSync`) applies `underlyingPriceForStructuralStop`
(Q39, `ex-dividend-adjustment.ts`): on an ex-dividend session, a LONG position's compare price is
adjusted by adding the cash dividend back, because the mechanical ex-div open-gap moves raw spot
down by roughly the dividend amount — a corporate action, not a thesis break. Q39's own header
states this precisely: *"A raw spot-vs-stop compare can false-trigger structural_stop for LONG
positions when the thesis did not actually break."*

Q37's re-check reimplemented the same raw compare Q39 was built to fix, one layer up, at
roll-execution time — the exact false-breach Q39 exists to prevent, reintroduced because this is
a separate compare, not a call into `structuralStopBroken`.

### Reachability (why this isn't theoretical)

`executionVerdictForGating` runs on every live roll-execution tick where `buildRollPlan` and the
roll-ledger accessors are injected (`syncSwingManagement`, `manage-sync.ts` line ~516) — i.e. the
real production path, not a rare/degraded branch. A LONG position that is a genuine roll
candidate (still-valid thesis, `expiry_risk` gate at low DTE with `rollIntent.roll === true`) on
an ordinary ex-dividend session would have its roll wrongly forced into a CLOSE by this
re-check — capital-preservation logic firing on a corporate action, not a real thesis break.

Also missing: the Q39 fail-safe. The primary path (`structuralStopBroken`) skips enforcing a LONG
structural stop entirely when `exDividendDataUnavailable === true` (this cycle's ex-div read
itself failed — a transient provider error must never silently re-enable the exact false-breach
Q39 exists to prevent). The Q37 re-check had no equivalent fail-safe at all.

### Evidence

New tests in `src/lib/swing/manage-sync-q37.test.ts`:
- `executionVerdictForGating (BUG): an ordinary ex-dividend gap must not force a false structural
  CLOSE on a LONG roll candidate` — LONG position, stop at 95, raw spot 94 (looks broken), ex-div
  session with $2 cash dividend (Q39-adjusted compare price 96, holds the stop). Pre-fix: FAILS
  (verdict wrongly flipped to `structural_stop`/CLOSE). Post-fix: PASSES (verdict unchanged).
- `executionVerdictForGating: ex-div data unavailable this cycle skips the LONG structural
  re-check (Q39 fail-safe), same as the primary path` — `exDividendDataUnavailable: true`.
  Pre-fix: FAILS (enforced anyway). Post-fix: PASSES (skipped, verdict unchanged).

RED→GREEN confirmed directly: both new tests failed before the fix (2/4 in the file), passed
after (4/4). The two pre-existing tests in the same file (intact-thesis, non-ex-div structural
break) were unaffected throughout, confirming the fix doesn't touch the non-ex-div behavior at
all.

Full verification: `src/lib/swing/manage-sync-q37.test.ts` 4/4 pass; the Q37 file plus
`manage-sync-q36.test.ts`, `manage.test.ts`, `roll.test.ts`, `ex-dividend-adjustment.test.ts`
43/43 pass; the whole swing lane (`src/lib/swing/**/*.test.ts`) 1459/1459 pass; full `npm test`
on Node 20, 14914/14917 pass / 0 fail / 3 skip (one unrelated flake on an earlier run that did
not reproduce on immediate re-run, confirmed not caused by this change); `npx tsc --noEmit`
clean.

### Fix

Apply the same `underlyingPriceForStructuralStop` adjustment to `reads.underlyingPrice` before
the Q37 compare (mirroring `structuralStopBroken`'s LONG/SHORT handling), and carry the same
Q39 fail-safe: when `reads.exDividendDataUnavailable === true` for a LONG position, skip the
re-check entirely (return the verdict unmodified) rather than enforce a stop that can't be
verified isn't a mechanical gap.

### Fix rationale

Reused the existing, already-tested `underlyingPriceForStructuralStop` helper rather than
duplicating its adjustment math inline — the same helper `structuralStopBroken` already calls,
so the two structural-stop checks can no longer silently diverge on ex-dividend handling. Did
not refactor Q37 to call `structuralStopBroken` directly (which would require constructing a
full `SwingManageInput`/`SwingDossier` just for this narrow re-check) — that's a larger,
unrelated change; applying the same adjustment function directly is the minimal fix that closes
the gap without widening the PR's surface.

### Blast radius

Single call site (`syncSwingManagement`, `manage-sync.ts`) uses `executionVerdictForGating`; no
other consumer. `structuralBreakFromSpot` (`live-plays.ts`) itself is unchanged and correctly
still used elsewhere for its own documented purpose (a spot-only fallback when no manage
snapshot exists yet) — this fix only changes what price is fed into it at the Q37 call site.
