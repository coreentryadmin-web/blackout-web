> **kind:** FINDING

## Thermal GEX Heatmap — `fmtMoney` picked its K/M/B unit off the raw value, so a value near a threshold never promoted — FIXED

| | |
|---|---|
| **Area** | Thermal desk — `src/features/thermal/components/GexHeatmap.tsx` |
| **Severity** | P3 — cosmetic/display, affects every dollar figure rendered by this panel (dealer flow, GEX king node, dealer rebalance notional, net calls/puts, band hedge sizing) |
| **Status** | FIXED |

### Root cause

`fmtMoney` picked its display unit (K/M/B) off the **raw, unrounded** magnitude via a threshold
check (`abs >= 1_000_000`, etc.), then rounded the quotient to that unit's own 1-decimal display
precision **afterward**:

```ts
if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
```

A value just under a unit's promotion threshold rounds UP past `999.95` once divided and
`.toFixed(1)`'d, overflowing its own unit's display range instead of promoting to the next one.
Concretely, `fmtMoney(999_950_000)`:

- `abs = 999_950_000` is `< 1_000_000_000`, so the raw-magnitude check picks the **M** branch.
- `(999_950_000 / 1_000_000).toFixed(1)` → `"999.95".toFixed(1)` → **`"1000.0"`**.
- Printed: **`"$1000.0M"`** — a four-digit "M" value that should have read `"$1.0B"`.

The identical shape bites the K→M boundary: `fmtMoney(999_950)` printed `"$1000.0K"` instead of
`"$1.0M"`. This is the same bug class fixed 11 times already this session across other desks
(Vector, Meridian, Helix) — a formatter that decides its unit before rounding, instead of after.

### Evidence (RED → GREEN)

Reproduced the raw arithmetic directly before touching any code:

```
$ node -e "console.log((999950000/1_000_000).toFixed(1))"
1000.0
$ node -e "console.log((999950/1000).toFixed(1))"
1000.0
```

Extracted the two formatters to a sibling pure-logic module
(`src/features/thermal/lib/gex-heatmap-money-format.ts`) with a direct unit test
(`gex-heatmap-money-format.test.ts`, 6 cases). Temporarily swapped the file back to the original
(buggy) implementation and re-ran the suite:

```
# RED (original raw-magnitude-first logic):
not ok 6 - fmtMoneySigned ... +$1000.0M  (expected +$1.0B)
# fail 4
# pass 2

# GREEN (fixed, round-first-then-promote logic):
# fail 0
# pass 6
```

### Fix rationale

Round the quotient to the unit's own 1-decimal precision **first**, then check whether that
rounded value itself crossed into the next unit's range (`>= 1000`) before formatting — same
"round-first-then-promote" pattern used by every prior fix in this bug class. If it crossed, divide
by 1000 again and promote; otherwise print at the original unit. The sub-`$1` "`·`" case and the
plain-dollar fallback (`abs < 1000`) are unchanged — they were never susceptible, since there is no
unit above the one they already use.

Left unchanged on purpose: the top-of-range B case (`abs >= 1_000_000_000`) still formats directly
off the raw value with no promotion check, because there is no unit above "B" to promote into —
the same accepted boundary every prior fix in this class leaves alone.

### Blast radius

`fmtMoney`/`fmtMoneySigned` were defined locally inside `GexHeatmap.tsx` and used at ~16 call
sites across that single file (dealer-flow tooltips, GEX king node labels, net call/put totals,
dealer rebalance notional, band-hedge tooltips, filtered totals). All 16 now resolve through the
single extracted, tested implementation — no other file defined or imported the old local
functions (confirmed via repo-wide grep), so there is no second copy of this bug elsewhere in this
file's blast radius.

### What was NOT touched

- `src/features/thermal/components/GexHeatmap.tsx`'s other formatters (`fmtPtsDelta`, `fmtStrike`,
  etc.) — out of scope, no promotion-boundary logic in them.
- `src/features/helix/components/HelixTideBar.tsx`'s `fmtMoney` and
  `src/features/helix/components/ContractDrilldownDrawer.tsx`'s `fmtNotional` — same bug shape,
  confirmed-live sibling leads from the prior round's handback, left open for a future round (see
  that round's "also noted" list; not touched here to keep this PR single-issue).
- `src/features/vector/lib/vector-pulse.ts`'s `fmtPremium` K-branch missing `.toFixed()` — a
  different, lower-priority, unverified cosmetic lead, not touched here.

### Tests

- `src/features/thermal/lib/gex-heatmap-money-format.test.ts` (new, 6 cases) — RED→GREEN proven
  above.
- Existing `GexHeatmap-*.test.ts` files (6 files, 23 tests total incl. the new ones) re-run clean
  against the updated component.
- `npx tsc --noEmit` clean.
