> **kind:** FINDING

## SPX Pulse sweep-premium formatter had no billions tier and no round-promote guard — FIXED

**Where:** `src/features/spx/lib/spx-pulse.ts`, the local (unexported) `fmtPremium()` helper used
only by `sweepToPulseSignal()` (the Tier-3 "large aggressive sweep" Pulse rail headline/why-string).

**Root cause:** this is a separate, drifted copy of the money formatter — not an import of the
file's own already-fixed `fmtNotional()` (round 473, PR #7727). It picked the display unit off the
raw, unrounded magnitude and rounded the quotient afterward with no check for whether that rounding
itself crossed the next unit's threshold, and it had no `B` tier at all:

```ts
function fmtPremium(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${(n / 1_000).toFixed(0)}K`;
}
```

`sweepToPulseSignal()`'s only floor is `SPX_SWEEP_MIN_PREMIUM` ($1,000,000) — there is no upper
bound, and real SPX single-sweep premium routinely clears nine figures and reaches into the
billions (SPX options trade at high per-contract notional). Concretely:
- `$1,500,000,000` rendered the literal `"$1500.0M"` instead of `"$1.5B"`.
- `$999,950,000` rendered `"$1000.0M"` instead of promoting to `"$1.0B"`.

This is the same unit-boundary defect class already fixed 15+ times across this repo this session
(`fmt-money.ts`'s `fmtPremium`, `zerodte-board-format.ts`'s `fmtMoney`, `helix-tide-money-format.ts`,
`gex-heatmap-money-format.ts`, `thermal-compact-matrix.ts`, this same file's own `fmtNotional`, …) —
missed here specifically because it is a drifted, un-exported duplicate rather than a shared helper,
so the canonical fix never reached it.

**Evidence:** RED (pre-fix) — `sweepToPulseSignal(brief({premium: 1_500_000_000}))` produced a
`line` containing `"$1500.0M"`; `sweepToPulseSignal(brief({premium: 999_950_000}))` produced
`"$1000.0M"`. Both new tests failed accordingly (2 failing, RED), confirmed by running the suite
unfixed. GREEN (post-fix): both now render `"$1.5B"` / `"$1.0B"` respectively; full
`spx-pulse.test.ts` suite 40/40 passing, `npx tsc --noEmit` clean.

**Fix:** applied the same round-first-then-promote guard `fmtNotional` already uses (round the
candidate M-quotient to its own display precision first, then re-check whether it reached 1000 of
that unit before promoting to B), plus added the missing B tier.

**Blast radius:** `fmtPremium` here is called from three sites inside `sweepToPulseSignal` (the
rail `line`, the `magnitude` premium label, and the `why` narration, including the conviction-floor
mention) — all three share the one function and are fixed together. No other call site references
this local helper (confirmed via grep); `fmtNotional` (the exported, already-fixed sibling used by
gamma-notional narration elsewhere in this file) was not touched.

| **Status** | FIXED |
