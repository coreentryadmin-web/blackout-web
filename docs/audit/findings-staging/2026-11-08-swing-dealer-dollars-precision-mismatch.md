> **kind:** FINDING

# Swing `formatDealerDollars`'s own round-400 fix (#7561) shipped with a precision mismatch

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Swing play-brief dealer-exposure reads — `src/lib/swing/format-nonzero.ts`'s `formatDealerDollars` |
| **Severity** | P3 — display-only magnitude mislabel, no calculation/trading impact |

## Root cause

PR #7561 (merged earlier the same day) fixed the original round-400 overflow bug in
`formatDealerDollars` (a value whose quotient rounds to 1000 inside a unit must promote to the
next unit instead of rendering e.g. `"1000.0M"`), but its own promotion guard introduced a new,
narrower defect: it rounded the quotient to the nearest **integer** to decide whether to promote

```ts
if (Math.round(abs / 1e9) >= 1000) return `${formatFixedNonZero(raw / 1e12, 1)}T`;
```

while the value that actually renders is rounded to **1 decimal place**
(`formatFixedNonZero(..., 1)`). Those two roundings disagree over the quotient range
`[999.5, 999.95)`: integer rounding sends `999.6` to `1000` (so the guard fires and promotes),
but 1-decimal rounding renders that same quotient as `"999.6"` — it never reached `1000.0` and
should stay in the lower unit.

Caught during pre-merge review of #7561 (adversarial check before trusting a green-CI PR, per
the standing review discipline) — the PR was merged by a parallel session on this account about
a minute before the review comment posted, so the regression shipped to `main` briefly before
this fix landed.

## Evidence (RED → GREEN)

`src/lib/swing/format-nonzero.ts` (live, confirmed by direct execution before writing the fix):

```
formatDealerDollars(999_500_000) -> "1.0B"   (WRONG — should be "999.5M")
formatDealerDollars(999_600_000) -> "1.0B"   (WRONG — should be "999.6M")
formatDealerDollars(999_940_000) -> "1.0B"   (WRONG — should be "999.9M")
formatDealerDollars(999_950_000) -> "1.0B"   (correct — 999.95 is the real 1dp boundary)
```

`src/lib/swing/format-nonzero.test.ts`:

**RED** (new tests against the #7561-shipped source, `git stash` of only the source file):
11 pass / **2 fail** — both new `[999.5, 999.95)` non-promotion-band tests.

**GREEN** (post-fix): 13 pass / 0 fail. `npx tsc --noEmit` clean.

## Blast radius

Same three call sites as #7561 itself (unchanged by this fix, only the promotion threshold
changed):
- `play-brief-intel.ts`'s `gexPostureSection` (Net GEX/VEX/DEX/CHARM, all four lines).
- `play-brief-narrative.ts`'s `dealerPostureLine`.
- `play-brief.ts`'s `tradeManagerNarrativeSection`'s net-GEX clause.

## Fix rationale

Round the quotient to 1 decimal place (`Math.round(x * 10) / 10`) before comparing against
`1000`, matching `formatFixedNonZero`'s own display precision — the same pattern already used
correctly by the sibling fix in `src/features/vector/lib/vector-crosshair-format.ts`'s `fmtGex`
(#7559, 1dp tier: `Math.round((abs / 1e6) * 10) / 10 >= 1000`). Deliberately did not touch
`formatFixedNonZero` itself or the false-zero-widening behavior — only the promotion-guard
precision.
