> **kind:** FINDING

# Meridian `fmtCompactMoney` overflows to a four-digit label at the K→M / M→B / B→T unit boundary

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Meridian earnings analytics — `src/lib/meridian/meridian-earnings-analytics-core.ts` |
| **Severity** | P3 — display-only magnitude mislabel, no calculation/trading impact |

## Root cause

`fmtCompactMoney` picks its display unit (`T`/`B`/`M`/`K`) off `Math.abs(v)` **before** rounding the
quotient to that unit's own display precision:

```ts
if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
if (abs >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
```

A value just under a threshold, that *rounds up* to 1000 of the smaller unit once `.toFixed()`
runs, falls into the wrong branch and overflows into a four-digit label instead of being promoted
to the next unit up:

- `fmtCompactMoney(999_550)` → `abs < 1e6`, takes the K branch: `(999550/1000).toFixed(0)` =
  `"1000"` → **`"$1000K"`**, instead of the correct `"$1.0M"`.
- `fmtCompactMoney(999_950_000)` → `abs < 1e9`, takes the M branch: `(999950000/1e6).toFixed(1)` =
  `"1000.0"` → **`"$1000.0M"`**, instead of the correct `"$1.00B"`.
- `fmtCompactMoney(999_995_000_000)` → `abs < 1e12`, takes the B branch:
  `(999995000000/1e9).toFixed(2)` = `"1000.00"` → **`"$1000.00B"`**, instead of `"$1.00T"`.

This is used by `MeridianEarningsAnalytics.tsx`'s earnings-analytics table to render
`actual_revenue`/`estimated_revenue` for every ticker — any company whose revenue lands in a
~0.05% window just under $1M/$1B/$1T renders a confusing overflowed four-digit figure in the
revenue column instead of the correct next-unit label.

## Evidence (RED → GREEN)

Added three boundary assertions (plus a negative-value mirror and a just-below-boundary control)
to the existing `formatters: null renders as an em-dash...` test in
`meridian-earnings-analytics-core.test.ts`.

**RED** (pre-fix source, same test file): `npx tsx --experimental-test-module-mocks --test
src/lib/meridian/meridian-earnings-analytics-core.test.ts` → 19 pass / **1 fail**:

```
999_550 must promote to M, never '$1000K'
+ actual - expected
+ '$1000K'
- '$1.0M'
```

**GREEN** (post-fix): same command → **20 pass / 0 fail**.

## Blast radius

Single call site: `MeridianEarningsAnalytics.tsx` (`actual_revenue ?? estimated_revenue` column).
No other file imports `fmtCompactMoney`. This is the exact same bug class already fixed six times
elsewhere in this repo — `fmt-money.ts`'s `fmtPremium`, `thermal-discord-card.ts`'s
`fmtCompactHeatMoney`, `darkpool-discord-format.ts`'s `fmtShares`,
`discord-context-enrichment.ts`'s `formatAdvShareLabel`, `helix-flow-format.ts`'s `fmtOi`, and
`group-greek-flow-summary.ts`'s inline `deltaM` formatter — but this Meridian instance was never
swept; it formats `$`-prefixed revenue magnitudes (T/B/M/K) rather than a bare M/K suffix, which is
likely why a text-pattern grep for the earlier fixes' exact shape missed it.

## Fix rationale

Same round-first-then-promote fix already applied at the other six sites: before taking a unit's
display branch, check whether the quotient **rounded to that unit's own display precision** would
hit 1000 — if so, fall through to the next unit up instead. Applied at all three boundaries
(K→M, M→B, B→T) since all three shared the identical defect shape; the T branch itself needs no
check (it is already the largest unit). Left the sub-$1,000 branch (`$${v.toFixed(0)}`) and the
overall null/NaN guard untouched — neither has a unit boundary to cross.
