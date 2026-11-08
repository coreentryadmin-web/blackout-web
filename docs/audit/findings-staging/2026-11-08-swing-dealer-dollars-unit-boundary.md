> **kind:** FINDING

# Swing `formatDealerDollars` never promotes M→B/B→T when rounding crosses the boundary

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Swing play-brief dealer-exposure reads — `src/lib/swing/format-nonzero.ts`'s `formatDealerDollars` |
| **Severity** | P3 — display-only magnitude mislabel, no calculation/trading impact |

## Root cause

`formatDealerDollars` picked the display unit (M/B/T) off the **unrounded** `raw` magnitude, then
rounded the quotient to 1 decimal *inside* that chosen unit:

```ts
if (abs >= 1e12) return `${formatFixedNonZero(raw / 1e12, 1)}T`;
if (abs >= 1e9) return `${formatFixedNonZero(raw / 1e9, 1)}B`;
return `${formatFixedNonZero(raw / 1e6, 1)}M`;
```

A value of `999,960,000` is `< 1e9`, so it took the `M` branch, then
`(999_960_000 / 1e6).toFixed(1)` rounds UP to `"1000.0"` — rendering the literal **`"1000.0M"`**
instead of promoting to the `B` tier it had actually rounded into (`"1.0B"`). The identical shape
recurs at the B→T boundary (`999,960,000,000` renders `"1000.0B"` instead of `"1.0T"`).

This is the exact same bug class independently fixed ~10 times elsewhere in this repo the same day
(`fmt-money.ts`'s `fmtPremium`, several Meridian/Thermal/Darkpool/Helix formatters, Vector's
crosshair legend `fmtGex` (#7559), the GEX heatmap money formatter (#7560), and the Meridian
revenue formatter (#7558)) — picking the display unit off the raw value before rounding the
quotient, so a value just under a threshold rounds up past 999/1000 in its chosen unit and never
promotes. `formatDealerDollars` was not among those fixes; found independently while auditing the
swing play-brief's dealer-exposure (Net GEX/VEX/DEX/CHARM) reads during a routine Ask Largo ×
Night Hawk Swings cycle.

## Evidence (RED → GREEN)

`src/lib/swing/format-nonzero.test.ts`:

**RED** (pre-fix, `git stash`): 9 pass / **2 fail**:
```
formatDealerDollars(999_960_000)      -> "1000.0B"  (expected "1.0B")
formatDealerDollars(999_960_000_000)  -> "1000.0B"  (expected "1.0T")
```

**GREEN** (post-fix): 11 pass / 0 fail. `npx tsc --noEmit` clean.

## Blast radius

Every real call site of `formatDealerDollars`, all member-facing Net GEX/VEX/DEX/CHARM dealer-
exposure lines in the swing play-brief:
- `play-brief-intel.ts`'s `gexPostureSection` (Net GEX/VEX/DEX/CHARM, all four lines).
- `play-brief-narrative.ts`'s `dealerPostureLine`.
- `play-brief.ts`'s `tradeManagerNarrativeSection`'s net-GEX clause.

All three already fail open on absent/stale data (unrelated to this fix) — this only changes the
unit chosen when the rounded quotient reaches 1000 at the M or B tier.

## Fix rationale

Mirrors the already-shipped guard used by every sibling instance of this bug class this same day:
check whether `Math.round(abs / <scale>)` reached 1000 and, if so, render from the next unit up
instead. Deliberately kept the existing `formatFixedNonZero` call (not a bare `.toFixed(1)`) at
every branch so the pre-existing false-zero-widening behavior (a real, tiny net GEX must never
collapse to "0.0") is preserved unchanged — only the unit-selection boundary was touched.
