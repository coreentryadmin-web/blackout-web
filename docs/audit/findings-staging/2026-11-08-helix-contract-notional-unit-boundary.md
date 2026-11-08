> **kind:** FINDING

# HELIX contract drilldown "Notional" stat never promotes K→M / M→B when rounding crosses the next unit

| | |
|---|---|
| **Status** | FIXED |
| **Area** | HELIX / `ContractDrilldownDrawer.tsx` ("Notional" stat) |
| **Severity** | P3 (cosmetic/display, no data integrity impact) |
| **Round** | 404 |

## Root cause

`ContractDrilldownDrawer.tsx`'s local `fmtNotional(n)` chose a display unit (K/M/B) by
checking the **raw, unrounded** magnitude of `n` against fixed thresholds, then rounded the
quotient to that unit's own display precision **afterward**, with no check for whether
rounding itself crossed the next unit boundary:

```ts
function fmtNotional(n: number | null): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}
```

Two concrete boundary cases this produced:

- `n = 999_600`: `999_600 < 1_000_000`, so the magnitude check takes the **K** branch. But
  `(999_600 / 1_000).toFixed(0)` evaluates to `"1000"` — the quotient itself crosses the
  1000 boundary when rounded. Result: the literal string **`$1000K`** instead of promoting
  to the M tier (`$1.0M`).
- `n = 999_950_000`: `999_950_000 < 1_000_000_000`, so the magnitude check takes the **M**
  branch. But `(999_950_000 / 1_000_000).toFixed(1)` evaluates to `"1000.0"` — same defect
  one tier up. Result: the literal string **`$1000.0M`** instead of promoting to the B tier
  (`$1.0B`).

This is byte-for-byte the same bug class fixed 14 times earlier this session (most recently
`helix-tide-money-format.ts`, PR #7562, for `HelixTideBar.tsx`'s sibling `fmtMoney`): picking
the unit off the pre-rounding value instead of the post-rounding value. It wasn't caught
earlier because every example in this class only manifests at a narrow band of values right
below a round-number threshold (e.g. $999.5K–$1M), which unit tests never previously covered
for this specific call site — there was no render harness or unit test for this component's
formatter at all before this fix.

## Evidence (RED → GREEN)

New test file: `src/features/helix/lib/helix-contract-notional-format.test.ts`.

**RED** (original buggy body, reverted temporarily to prove the regression):
```
not ok 6 - fmtNotional: a K-unit quotient that rounds up to 1000 promotes to M instead of rendering $1000K
    actual: '$1000K'
    expected: '$1.0M'
not ok 7 - fmtNotional: an M-unit quotient that rounds up to 1000 promotes to B instead of rendering $1000.0M
    actual: '$1000.0M'
    expected: '$1.0B'
```

**GREEN** (fixed body): `# pass 8 / # fail 0`.

Command: `npx tsx --experimental-test-module-mocks --test src/features/helix/lib/helix-contract-notional-format.test.ts`
(Node 20.20.2, per CLAUDE.md's "run tests on Node 20" guidance).

## Fix rationale

Mirrors the established round-first-then-promote guard (same shape as
`helix-tide-money-format.ts`'s `fmtMoney`, `gex-heatmap-money-format.ts`, and the other 13
sibling fixes this session): after picking a unit, round the quotient to that unit's own
display precision **first**, then check whether the rounded value reached `1000` — if so,
re-render from the next unit up instead of accepting the pre-promotion string. The B tier
(the top unit here) is left without a further promotion guard, consistent with every sibling
fix in this class — there is no unit above B in this formatter's scope, matching
`helix-tide-money-format.ts`'s own convention.

Extracted the pure logic out of `ContractDrilldownDrawer.tsx` (a `"use client"` component
with no render harness in this repo — CLAUDE.md lesson #3) into a new sibling module,
`src/features/helix/lib/helix-contract-notional-format.ts`, so it can be unit-tested
directly without a React render harness. The component now imports `fmtNotional` from that
module instead of defining it locally.

## Blast radius

Single call site: `ContractDrilldownDrawer.tsx`'s "Notional" `PrintStat` (line ~331,
`value={fmtNotional(detail.notional)}`). No other file duplicates this exact function.

A structurally similar but **separately named and separately owned** `fmtNotional` exists in
`src/features/spx/lib/spx-pulse.ts` — that file is in the SPX feature area, which is on the
standing hard-exclusion list for this audit lane, and was deliberately left untouched.

## What was deliberately left unchanged

- No change to `fmtPrem` in `src/features/meridian/components/MeridianEventDetailPanel.tsx`
  (round 404's lead #1) — verified by grep that it has zero call sites anywhere in `src/`,
  confirming it is dead code (the same conclusion round 400 reached for a different function
  in the same file). Fixing dead code would not change any rendered output, so it was
  correctly skipped per this round's own instructions.
- No change to `src/features/vector/lib/vector-pulse.ts`'s `fmtPremium` (lead #3) — not
  investigated this round since lead #2 was a confirmed, live, real instance of the same bug
  class; left for a future round to verify independently.
- No change to `spx-pulse.ts`'s `fmtNotional` — out of scope (hard exclusion list).
