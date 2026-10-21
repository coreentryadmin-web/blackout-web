## 2026-10-21 — [FINDING, P2 Night Hawk Swings / Ask Largo closed-deck] closedDeckSourcesFromChains nulls entry/peak/trough premium for a non-terminal worst leg instead of borrowing the real per-leg value — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|------------|-------|

### Symptom

Live `GET /api/market/swing/record` (production, 2026-10-21): for a multi-leg roll chain where the
"worst" (most-negative) leg is an EARLIER leg rather than the terminal leg, the served `closedDeck`
row correctly re-points `contract`/`occ`/`mid`/`delta`/`exitPnlPct` at the worst leg's own data — but
`entryPremium` is always served as `null`, even when the worst leg's own row carries a real value.

Two live chains reproduced it:
- AMZN positionId 48 (root chain 44): worst leg = leg 44 (ROLLED, strike 605, expiry 2026-10-16,
  `realized_pnl_pct` −27.67%, `entry_premium` 5.15, `exit_mark`/`last_mark` 3.73). The served row
  correctly shows `exitPnlPct: -27.67`, the correct strike/expiry/occ, and the correct mid 3.73 — but
  `entryPremium: null` despite 5.15 sitting on the exact same row object already read for the other
  fields.
- AAPL positionId 40 (root chain 37): worst leg = leg 37 (`entry_premium` 6.73, `exit_mark` 5.23,
  `realized_pnl_pct` −22.3%). Same pattern — `exitPnlPct: -22.3` correct, `entryPremium: null`.

Aggregate win/loss grading math on this route was independently re-verified correct in the same
audit (`resolved_chains=21=wins(3)+losses(18)+breakevens(0)`) — this was a display/completeness gap
only, never a grading-math defect, and no grading/aggregation logic was touched by this fix.

### Root cause

`src/lib/swing/closed-plays.ts`, `closedDeckSourcesFromChains` (~lines 367-373, pre-fix). When the
worst leg isn't the terminal leg, the function already resolves `worstLegRow` (the worst leg's own
`SwingPositionRow`) and correctly borrows its `contract_strike`/`contract_expiry`/`contract_occ`/
`last_mark`/`contract_delta` via `contractBundleFromRow(worstLegRow)` (the 2026-10-11 and 2026-10-18
fixes, same file). But the three sibling fields were built as:

```ts
entryPremium: worstLegIsTerminal ? src.entryPremium : null,
peakPremium: worstLegIsTerminal ? src.peakPremium : null,
troughPremium: worstLegIsTerminal ? src.troughPremium : null,
```

— unconditionally `null` in the non-terminal case, never borrowed from `worstLegRow`. The adjacent
code comment (2026-09-15 fix, since corrected) asserted these fields have "no per-leg equivalent to
borrow" — that assertion is false. `entry_premium`/`peak_premium`/`trough_premium` are real per-row
(per-leg) columns on `swing_positions` (`SwingPositionRow` in `src/lib/db.ts`), the exact same class
as `contract_strike`/`last_mark`/`contract_delta`, which this same function already correctly borrows
from `worstLegRow` two lines away. The 2026-09-15 fix was right to stop pairing the TERMINAL leg's
bounds with the worst leg's P&L (that was a genuine, different bug — see that fix's own comment) —
but it reached for "omit" when "borrow the worst leg's own real value" was available and just as
cheap, the same fix shape the 2026-10-11/2026-10-18 fixes already applied one field over. Not caught
earlier because every existing regression test for this path asserted the (wrong) `null` outcome
directly, so the suite was self-consistent with the bug rather than catching it.

### Fix

Resolve `worstLegRow.entry_premium`/`peak_premium`/`trough_premium` (rounded via the file's existing
`round2`) and use them in the non-terminal branch instead of `null`, falling back to `null` only when
the worst leg's own column is genuinely absent (a real data gap, not a leg-mismatch one):

```ts
const worstLegEntryPremium =
  worstLegRow?.entry_premium != null ? round2(worstLegRow.entry_premium) : null;
const worstLegPeakPremium =
  worstLegRow?.peak_premium != null ? round2(worstLegRow.peak_premium) : null;
const worstLegTroughPremium =
  worstLegRow?.trough_premium != null ? round2(worstLegRow.trough_premium) : null;
...
entryPremium: worstLegIsTerminal ? src.entryPremium : worstLegEntryPremium,
peakPremium: worstLegIsTerminal ? src.peakPremium : worstLegPeakPremium,
troughPremium: worstLegIsTerminal ? src.troughPremium : worstLegTroughPremium,
```

Also corrected the two stale code comments (2026-09-15 and 2026-10-11 fix write-ups) that asserted
or implied these fields have no per-leg equivalent — they do, and the misconception was the root
cause, not a formatting nit.

### Blast radius

Single call site: `closedDeckSourcesFromChains` is the only place in the codebase that builds a
chain-composite closed-deck row, and `entryPremium`/`peakPremium`/`troughPremium` are plain fields on
`SwingClosedDeckSource` with no other producer to touch. No other consumer of `SwingPositionRow`'s
`entry_premium`/`peak_premium`/`trough_premium` columns was changed — `closedDeckSourceFromRow` (the
single-leg/terminal-leg path) already read them directly and was already correct; this fix only
changes the non-terminal-worst-leg branch of the chain-composite path.

### Deliberately left unchanged

- Grading/aggregation math (`buildSwingRecord`, win/loss/breakeven composite outcome) — untouched,
  independently re-verified correct before this fix.
- `closedReason`/`contract`/`occ` re-pointing logic (2026-09-13/2026-09-15/2026-10-11/2026-10-18
  fixes) — unchanged; this fix only extends the same "borrow from `worstLegRow`" pattern those fixes
  already established to the three premium fields that had been left out of it.
- The genuine-absence fallback (`worstLegRow`'s own column is `null`) still serves `null` — honest
  omission is still correct when the worst leg's own row truly lacks the value, per this codebase's
  absence principle; only the leg-mismatch case (the real value existing but never being read) was
  the bug.

### Evidence

Regression test added to `src/lib/swing/closed-plays.test.ts` (`closedDeckSourcesFromChains` describe
block): a 2-leg chain fixture with the worst leg non-terminal, asserting `entryPremium`/
`peakPremium`/`troughPremium` in the result equal the worst leg's own real values (not `null`, not
the terminal leg's values) — reproducing the live AMZN positionId 48/44 shape with the exact values
from the production repro above. RED→GREEN proven via `git stash` on the source file only (never the
test file): with the pre-fix source, 2 tests fail (`null !== 5.15` on the new AMZN-repro test, plus
the updated existing test asserting the worst leg's own bounds); with the fix restored, all 32 tests
in the file pass. Full `src/lib/swing/*.test.ts` suite: 1992/1992 pass. `npx tsc --noEmit`: clean.
