> **kind:** FINDING

## HELIX tide bar `fmtMoney` never promotes K→M or M→B when rounding crosses the next unit — FIXED

| **Status** | FIXED |
|---|---|

### Root cause

`HelixTideBar.tsx`'s local `fmtMoney` picked its display unit (K/M/B) off the **raw,
unrounded** magnitude, then rounded the quotient to that unit's own display precision
**afterward**, with no check for whether the rounding itself pushed the value into the next
unit:

```ts
function fmtMoney(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
```

A net premium of `$999,600` is `< 1_000_000`, so it takes the K branch; `(999600 /
1000).toFixed(0)` rounds **up** to `"1000"`, rendering the literal `"$1000K"` instead of
promoting to `"$1M"`. The identical shape repeats one tier up: `$999,600,000` is `<
1_000_000_000` so it takes the M branch, and `(999600000 / 1_000_000).toFixed(0)` rounds to
`"1000"`, rendering `"$1000M"` instead of `"$1.0B"`.

This is the same bug class as 13 prior fixes this session — e.g.
`src/features/thermal/lib/gex-heatmap-money-format.ts` (PR #7560, round 402) and
`src/lib/meridian/meridian-earnings-intel-core.ts`'s `fmtPremShort` (PR #7557) — a formatter
that branches on the raw value and rounds the chosen unit's quotient without re-checking
whether that rounding crossed the unit's own boundary.

### Evidence (RED → GREEN)

Reproduced the shipped defect standalone before touching anything:

```
K->M boundary 999,600:       $1000K   (should be $1M)
M->B boundary 999,600,000:   $1000M   (should be $1.0B)
```

New regression test `helix-tide-money-format.test.ts` proves both:
- **RED** (temporarily reverted the fix back to the shipped logic): 2/4 tests failed,
  `fmtMoney(999_600) === "$1000K"` and `fmtMoney(999_600_000) === "$1000M"`.
- **GREEN** (fix restored): 4/4 pass — `fmtMoney(999_600) === "$1M"`,
  `fmtMoney(999_600_000) === "$1.0B"`, plus unaffected-ordinary-value and
  already-at-boundary regression cases.

### Blast radius

Only one call site: `HelixTideBar.tsx` uses `fmtMoney` exclusively for the "calls
bought"/"puts sold" labels in the HELIX page-header tide indicator (`callPrem`/`putPrem`
from `/api/market/spx/merged`'s `tide_call`/`tide_put`). No other file imported or
duplicated this exact function — checked via repo-wide grep for `fmtMoney` definitions; the
sibling `fmtNotional` in `ContractDrilldownDrawer.tsx` has the identical shape but is a
separate, not-yet-fixed function (left for a future round per the hand-off note — fixing
one issue per PR here).

### Fix rationale

Mirrors the already-shipped round-first-then-promote guard pattern used in every sibling
fix this session: after computing the quotient for the chosen unit, round it to that unit's
own display precision and check whether the rounded value reached `1000` — if so, re-render
from the next unit up instead of returning the overflowed string. Deliberately kept the
promoted-to-M case using the M branch's own 0-decimal precision (not a fabricated extra
decimal) so promotion renders identically to a value that was always in that unit.

Extracted `fmtMoney` out of `HelixTideBar.tsx` (a `"use client"` React component with no
render harness in this repo, per the standing CLAUDE.md lesson) into a sibling pure module,
`src/features/helix/lib/helix-tide-money-format.ts`, so the formatting logic — the actual
locus of the bug — can be unit-tested directly without rendering React. The component now
imports it; behavior is otherwise unchanged.

### Files changed

- `src/features/helix/lib/helix-tide-money-format.ts` (new — extracted, fixed `fmtMoney`)
- `src/features/helix/lib/helix-tide-money-format.test.ts` (new — RED→GREEN regression test)
- `src/features/helix/components/HelixTideBar.tsx` (now imports the extracted formatter)
