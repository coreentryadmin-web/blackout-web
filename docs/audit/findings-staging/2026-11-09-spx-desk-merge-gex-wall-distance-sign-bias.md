# SPX desk's recalcGexWallDistances had the same sign-bias rounding tie as topGexWalls

> **kind:** `FINDING`

## Status

FIXED

## Root cause

`src/features/spx/lib/spx-desk-merge.ts`'s `recalcGexWallDistances` recomputed each `GexWall`'s
`distance_pts` with:

```ts
distance_pts: Math.round((w.strike - spot) * 100) / 100,
```

`Math.round()` on a signed value ties toward `+Infinity` (`Math.round(-262.5) === -262` but
`Math.round(262.5) === 263`), so a strike sitting exactly on a half-cent tie below spot rounds to
a smaller magnitude than the mirror-image strike the same distance above spot.

This is an independently copy-pasted duplicate of the identical buggy line in
`src/lib/providers/gamma-desk.ts`'s `topGexWalls`, fixed in PR #7680 (the ninth confirmed instance
of this sign-bias rounding-tie bug class in this codebase, after `fmt-money.ts`'s `fmtPct`,
`round-floats.ts`, `shift-math.ts`, `PlayTerminal.tsx`'s `signPct`, `ZeroDteCommandPanel.tsx`'s own
`signPct`, `format.ts`'s Net VEX line, and `gamma-desk.ts`'s `topGexWalls` itself). #7680's own PR
description explicitly flagged this SPX-side sibling as out of scope for that PR and left it as a
lead — this finding picks that lead up.

`recalcGexWallDistances` is the SPX desk's live-merge path: it re-derives `gex_walls` (and the
`kind` support/resistance flip) every time a fresh spot price is merged into the desk payload
(`mergeFlowIntoDesk`/`mergePulseIntoDesk`, lines 294 and 506), so the biased `distance_pts` is
served over `GET /api/market/spx/desk` to every SPX Slayer member and to Largo's SPX read.

## Evidence (RED → GREEN)

Added to `src/features/spx/lib/spx-desk-merge.test.ts`, using the same tie-triggering fixture
shape as #7680 (`spot = 7542.375`, `above = 7545` → tie at `+262.5`, `below = 7539.75` → mirror
tie at `-262.5`):

Pre-fix (RED, reproduced by stashing the fix): 1 of 4 new subtests failed —
`recalcGexWallDistances` returned `distance_pts: -2.62` for the below-spot tie instead of the
symmetric `-2.63` the above-spot tie already got correctly.

Post-fix (GREEN): all 30 tests in `spx-desk-merge.test.ts` pass (26 pre-existing + 4 new).
`npx tsc --noEmit` clean.

## Blast radius

Both call sites of `recalcGexWallDistances` live inside this one file (`mergeFlowIntoDesk` line
294, `mergePulseIntoDesk` line 506) — no other module re-implements or re-exports this function.
Checked via repo-wide grep for `recalcGexWallDistances` and for the bare-`Math.round` +
strike-minus-spot shape; no further undiscovered duplicates found.

## Fix rationale

Same fix as all eight prior siblings: round the magnitude, then reapply sign
(`Math.sign(w.strike - spot) * Math.round(Math.abs(w.strike - spot) * 100) / 100`). Verified
`strike === spot` still returns plain `0`, never `-0` (`Math.sign(0) === 0`), matching the existing
behavior and PR #7680's own verification of the same edge case. The `kind` (support/resistance)
flip logic on the same line is untouched — only the `distance_pts` expression changed.
