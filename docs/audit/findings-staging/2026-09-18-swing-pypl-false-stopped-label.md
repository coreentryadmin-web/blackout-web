> **kind:** `FINDING`

## Ask Largo swing play-brief mislabeled a true flat/breakeven scratch exit as "stopped" — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo play-brief (`src/lib/swing/closed-plays.ts`) — found via the Ask Largo standing mandate's 5-engine health-check deep-dive |
| **Severity** | P2 (real, actively misleading trade-management coaching on a member-facing closed-position brief) |
| **PR** | fix/swing-pypl-false-stopped-label |

### Root cause

`closedDeckSourceFromRow`'s `closedReasonFromRow` helper compared the raw, unrounded
`row.realized_pnl_pct` directly against zero (`pnl > 0` / `pnl < 0` / else `"flat"`). A position
that closed at EXACTLY its entry price (`entryPremium === peakPremium === troughPremium`, a true
flat/breakeven scratch, not a rounding artifact) can still carry a tiny nonzero `realized_pnl_pct`
from float-division residue (e.g. `-0.0001`), which the unrounded `pnl < 0` check labeled
`"stopped"` — factually wrong, since a stop-loss never fired and the premium never moved.

This is the exact same bug class already fixed once, in the same file, for the same live example:
`closedDeckSourcesFromChains`'s own 2026-09-13 fix comment names "PYPL#24" directly and claims the
sibling single-leg mapper (`closedReasonFromRow`, the function this fix touches) "already gets this
right with a real three-way split" — that claim was wrong; `closedReasonFromRow` had the identical
unrounded-zero-check defect, just never caught because `play-brief-resolve.ts` calls it directly and
bypasses the composite path entirely, so the earlier fix never reached this call site.

Live repro (real production data, authenticated Clerk session): PYPL positionId 24 (closed
2026-08-21, `entry_premium === peak_premium === trough_premium === $3.90`) is correctly labeled
`closedReason:"flat"`/`exitPnlPct:0` by `/api/market/swing/record`'s closedDeck (which reads through
the already-fixed composite path), but the SAME position's `/api/market/swing/play-brief` (which
reads through the unfixed `closedDeckSourceFromRow` directly) rendered **"STOPPED — PYPL 65P
28DTE"**, `"Reason: stopped"`, `"Exit P&L: -0.0%"`, and actively wrong trade-manager coaching:
*"Stop fired (stopped) — check if entry was extended past invalidation."* Two live endpoints gave
two disagreeing answers about the same closed position.

### Evidence

- Live PYPL#24 repro as described above (two endpoints disagreeing on the same position).
- `closedReasonFromRow` confirmed to compare raw `pnl` with no rounding, pre-fix.
- RED→GREEN independently reproduced via `git stash` (fix isolated to `closed-plays.ts`): 12/13
  fail pre-fix (the new float-residue test), 13/13 pass post-fix.
- New tests cover both directions: a float-residue near-zero P&L now labels `"flat"`, and a real,
  rounds-to-nonzero loss still correctly labels `"stopped"` (the fix does not weaken the real case).
- `src/lib/swing/*.test.ts` full sweep: 1352/1352 pass.
- `npx tsc --noEmit -p .` on Node 20: clean.

### Blast radius

Single function (`closedReasonFromRow`), consumed by `closedDeckSourceFromRow` and therefore by
`play-brief-resolve.ts`'s CLOSED-bucket brief composition. The sibling `closedDeckSourcesFromChains`
path (used by `/api/market/swing/record`) was already correct — this fix only brings the single-leg
mapper the play-brief actually calls into agreement with it. No change to `realized_pnl_pct` itself
or any P&L computation — only how a near-zero value is labeled.

### Fix rationale

Round `pnl` to 2 decimal places (the same `round2` helper already used elsewhere in this file, and
the same pattern the 2026-09-13 composite-path fix used) before the sign comparison, so a genuine
float-residue near-zero reads as `"flat"` while any real, rounds-to-nonzero P&L keeps its correct
`"target"`/`"stopped"` label unchanged.

### Verification

Independently re-verified from scratch on a fresh branch off actual latest `origin/main` (which
already carries the 2026-09-18 near-tie-wording and false-zero-precision merges) — RED/GREEN
independently reproduced via `git stash`; broader `swing/*.test.ts` sweep and `tsc --noEmit` both
clean.
