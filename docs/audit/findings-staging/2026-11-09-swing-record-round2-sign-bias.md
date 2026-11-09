# `record.ts`'s `round2` had the sign-bias rounding tie — the roll-chain record's own preserved-loss witness could understate a loss's magnitude

> **kind:** `FINDING`

### Summary
`src/lib/swing/record.ts`'s `round2` helper — the sole rounding primitive behind every bidirectional
P&L figure the swing roll-chain record computes and the `/api/market/swing/record` HTTP route serves
to members/Largo — rounded with plain `Math.round(n * 100) / 100`.

`Math.round` ties toward `+Infinity` (`Math.round(-12.5) === -12` but `Math.round(12.5) === 13`), so a
losing (negative) P&L sitting exactly on a 2-decimal rounding tie rounded to a SMALLER magnitude than
the identical-size winning mirror-image move would. This is the 16th confirmed instance of this exact
bug class in this codebase this session (after `underlying-excursion.ts`'s `signedExcursionPct`,
`fmt-money.ts`'s `fmtPct`, `round-floats.ts`, `debrief.ts`'s `round2`, `gamma-desk.ts`'s
`distance_pts`, and others), and the second found inside the Swing engine's own code specifically.

### Root cause
`round2` is called on four bidirectional values: `realizedPnlPct` (per-leg), `worstLegPnlPct` (the
chain composite's MIN over graded legs — this file's own header names it "the explicit
preserved-loss witness"), `sumPnlPct`, and `compoundedReturnPct`. All four can be negative. None of
the call sites separated magnitude from sign before rounding.

This is not purely cosmetic for `worstLegPnlPct` specifically: `buildSwingRecordSummary`'s
`breakevens` field tests `composite.worstLegPnlPct === 0` as a precise (not approximate) signal that
no leg in the chain was genuinely negative (see the field's own doc comment). A real, small loss
sitting exactly on a tie — e.g. raw `-0.005` → `-0.005*100 = -0.5` → `Math.round(-0.5) === -0` (ties
toward `+Infinity`, so `-0.5` rounds UP to `0`, not down to `-1`) — rounds to `-0`, which
`JSON.stringify`s and compares as exactly `0`, misclassifying a real (if tiny) loss as a breakeven.
The mirror-image `+0.005` gain correctly rounds to `0.01` under the identical tie rule, so the two
sides of an otherwise-symmetric situation disagree for no economic reason.

Found via a continuation of this session's own standing sweep of `src/lib/swing/*.ts`'s `round2`-
shaped helpers (started while fixing `underlying-excursion.ts`, PR #7701) — `record.ts`'s `round2`
was flagged there as a plausible, not-yet-verified candidate ("rounds `realizedPnlPct`... bidirectional,
used by the public `/api/market/swing/record` route") and is now confirmed with a constructed exact-
tie repro.

### Evidence (RED → GREEN)
New test in `src/lib/swing/record.test.ts` (`round2's sign-bias tie: a losing leg at an exact 2dp tie
rounds to the SAME magnitude as its winning mirror`). Fixture uses `realized_pnl_pct = ±0.125` — exact
binary fractions (±1/8) so `*100` lands precisely on a `±12.5` tie, not merely close to one (ordinary
floating-point division noise would otherwise mask the bug on an inexact near-tie):

```
RED (pre-fix, git-stash of just record.ts): 15/16 pass, 1 fail
  loss leg (-0.125):  realizedPnlPct -0.12, worstLegPnlPct -0.12  (asymmetric)
  win leg  (+0.125):  realizedPnlPct  0.13, worstLegPnlPct  0.13
GREEN (post-fix): 16/16 pass
  loss leg (-0.125):  realizedPnlPct -0.13, worstLegPnlPct -0.13  (symmetric with the win leg)
```

Full regression: `src/lib/swing/*.test.ts` — 2311/2311 pass. `npx tsc --noEmit` clean. Full project
`npm test` run in the background to confirm no cross-module regression (see this PR's CI for the
result).

### Blast radius
Single helper, `round2`, used only within `record.ts` itself. Real consumers of its output (confirmed
via grep): the `/api/market/swing/record` HTTP route (`buildSwingRecord`/`buildSwingRecordSummary`,
the route's own `roundFloats()` wrapper is a no-op on an already-2dp value, unchanged by this fix),
and `SwingAnalyticsPanel.tsx` (reads the route's response, no direct import). `isSwingWin`'s win/loss
classification is NOT affected — it deliberately checks the RAW `r.realized_pnl_pct`, never the
rounded value (confirmed unchanged), so no chain's `outcome`/`win`/`loss` label can flip from this
fix. `selectSwingRecordRootIds` (used by `closed-position-snapshots/route.ts`) and `horizon-outcomes.ts`'s
`isSwingWin` import are both untouched by this change — neither touches `round2`.

### Fix rationale
Round by magnitude, then reapply sign (`Math.sign(n) * Math.round(Math.abs(n) * 100)) / 100`) — the
identical, already-reviewed fix shape every prior sibling instance of this bug class in this codebase
used, including this session's own `underlying-excursion.ts` fix earlier today. Kept local to
`record.ts`'s own `round2` definition (not refactored into a shared import), matching the file's
existing style of defining its own small helpers rather than depending on another feature's
formatter. Every other behavior (the per-leg-then-composite rounding order documented in the
existing code comments, the `win` check against the raw value, the `breakevens` exact-0 test) is
unchanged — only the rounding direction at an exact tie changes.

| **Status** | FIXED — this PR. |
