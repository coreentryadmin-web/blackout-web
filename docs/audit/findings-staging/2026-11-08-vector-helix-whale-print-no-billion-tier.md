> **kind:** FINDING

# Vector "HELIX whale print" reason bullet has no billions tier — overflows into a four-digit "$1500.0M" instead of promoting to "$1.5B"

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Vector / `vector-play-candidates.ts` (`rankPick`'s "HELIX whale print" reason bullet) |
| **Severity** | P3 (cosmetic/display, no data integrity impact) |
| **Round** | 421 |

## Root cause

`rankPick` (inside `src/features/vector/lib/vector-play-candidates.ts`) formats the flow-whale
reason bullet shown on a Vector contract pick with a bare, local division — no shared formatter,
no unit-promotion logic at all:

```ts
reasons.push(`HELIX whale print $${(flowAt / 1_000_000).toFixed(1)}M at this strike`);
```

`flowAt` is the largest single flow print's premium at the picked contract's exact strike
(`flowPremiumAtStrike`). This line only ever divides by `1_000_000` and appends a literal `M` —
there is no billions branch and no "does the rounded quotient itself cross 1000" guard, so any
single print at or above `$1,000,000,000` renders as a four-digit `M` string instead of promoting
to `B`. Concrete boundary case: `flowAt = 1_500_000_000` → `(1_500_000_000 / 1_000_000).toFixed(1)`
evaluates to `"1500.0"` → the member-visible reason text reads **`HELIX whale print $1500.0M at
this strike`** instead of the correct **`HELIX whale print $1.5B at this strike`**.

This is the same unit-boundary bug class fixed repeatedly elsewhere this session (`fmt-money.ts`'s
`fmtPremium`, `thermal-compact-matrix.ts`'s `fmtCompactHeatMoney`, `DarkPoolPanel.tsx`'s
`fmtShares`, `discord-context-enrichment.ts`'s `formatAdvShareLabel` — all of which this round
re-checked and confirmed already carry the round-first-then-promote / billions-tier fix, per their
own in-code comments referencing it). This one call site in `vector-play-candidates.ts` was the
one sibling in that same audit sweep that never got the fix at all — not a narrow rounding-edge
miss like the others, but a flat-out missing B tier.

Note on realistic trigger frequency: a single options print with >= $1B of premium is extreme
(the largest real block trades run tens to low hundreds of millions), so this is unlikely to have
fired on live HELIX flow data yet. It is fixed anyway, consistent with how `fmt-money.ts`'s own
billions branch is documented as a defensive correctness guard rather than a response to a
specific observed production value, and because a malformed/outlier upstream premium read should
still render correctly rather than silently overflowing into a wrong-looking number.

## Evidence (RED → GREEN)

New test in `src/features/vector/lib/vector-play-candidates.test.ts`:
`"HELIX whale print >= $1B is labeled in B, not an overflowed four-digit M"`.

**RED** (original buggy line):
```
not ok 6 - HELIX whale print >= $1B is labeled in B, not an overflowed four-digit M
  error: 'expected "$1.5B", got: HELIX whale print $1500.0M at this strike'
```

**GREEN** (fixed line): full file `# pass 21 / # fail 0`.

Command: `npx tsx --experimental-test-module-mocks --test
src/features/vector/lib/vector-play-candidates.test.ts` (Node 20.20.2, per CLAUDE.md's "run tests
on Node 20" guidance).

`tsc --noEmit` on the touched files is clean.

## Fix rationale

Rather than re-implementing yet another local round-first-then-promote branch, this call site now
imports and reuses the existing single-source-of-truth formatter, `fmtPremium` from
`src/lib/fmt-money.ts` — which already carries the billions branch, the round-before-promote
guard at both the M→B and K→M boundaries, and a NaN/Infinity guard, and is explicitly documented
there as the canonical replacement for ad-hoc copies of this exact formatter across the codebase:

```ts
reasons.push(`HELIX whale print ${fmtPremium(flowAt)} at this strike`);
```

This both fixes the missing-B-tier defect and removes a duplicate, slightly-different
implementation of a formatter that already has one correct, tested home — rather than adding a
15th near-copy of the same logic.

## Blast radius

Single call site: the "HELIX whale print" reason bullet inside `rankPick`
(`vector-play-candidates.ts`). The sibling "HELIX flow $...K confirms this strike" bullet a few
lines below (`FLOW_CONFIRM` branch) is bounded below `FLOW_WHALE` (500K) and was left unchanged —
it cannot reach the M/B boundary in this code path and touching it would be unrelated scope creep.

## What was checked and ruled out this round

- `src/features/meridian/components/MeridianEventDetailPanel.tsx`'s `fmtPrem` — re-confirmed dead
  code (zero call sites in `src/`, same conclusion round 404 already reached); left untouched per
  standing guidance not to "fix" unreachable code.
- `src/features/helix/components/DarkPoolPanel.tsx`'s `fmtShares` — already carries the
  round-first-then-promote fix (in-code comment references it explicitly); no bug present.
- `src/features/thermal/lib/thermal-compact-matrix.ts`'s `fmtCompactHeatMoney` — already carries
  the billions tier and the round-before-promote guard at both boundaries; no bug present.
- `src/lib/discord-context-enrichment.ts`'s `formatAdvShareLabel` — already carries the
  round-first-then-promote fix (in-code comment references the Thermal/`fmt-money.ts` fixes it
  mirrors); no bug present.
- `src/app/api/market/flow-brief/route.ts` — excluded (calls only into `src/lib/bie/flow-brief.ts`,
  which is on the standing hard-exclusion list for this audit lane).

Of the 5 flagged files this round, 4 were already fixed and 1 (`MeridianEventDetailPanel.tsx`) is
dead code. The genuine, fixable instance found this round (`vector-play-candidates.ts`) was
discovered via a fresh targeted grep for `toFixed(1)` across the repo rather than from the flagged
list itself.
