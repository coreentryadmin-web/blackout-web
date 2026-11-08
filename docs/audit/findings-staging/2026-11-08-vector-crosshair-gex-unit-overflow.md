> **kind:** FINDING

## Vector chart crosshair legend's GEX figure overflows its display unit at the K→M and M→B boundaries — FIXED

| | |
|---|---|
| **Area** | Vector desk — chart crosshair legend (GEX heatmap overlay) |
| **Status** | FIXED |
| **File** | `src/features/vector/components/VectorCrosshairLegend.tsx` (now `src/features/vector/lib/vector-crosshair-format.ts`) |
| **Function** | `fmtGex` |

### Root cause

`fmtGex` (the formatter behind the "GEX `<strike>` `<value>`" line painted on hover over the
chart's GEX heatmap overlay, called from `renderVectorCrosshairLegend`) picked its display unit
(K/M/B) off the **raw, unrounded** magnitude, then rounded the quotient to that unit's own display
precision afterward:

```ts
function fmtGex(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;   // <- unit picked BEFORE rounding
  if (abs >= 1e3) return `${(n / 1e3).toFixed(0)}K`;   // <- unit picked BEFORE rounding
  return Math.round(n).toLocaleString("en-US");
}
```

A value just under a unit threshold rounds **up** past 999/1000 once formatted to that unit's own
precision, and the function never promotes it to the next unit — it had already committed to the
smaller unit's branch before rounding happened. Both the K→M and M→B boundaries have the defect:

- `999_600` (a plain GEX value) is `< 1e6`, so it took the `K` branch; `(999_600 / 1e3).toFixed(0)`
  rounds UP to `"1000"`, rendering the literal **`"1000K"`** instead of promoting to **`"1.0M"`**.
- `999_950_000` is `< 1e9`, so it took the `M` branch; `(999_950_000 / 1e6).toFixed(1)` rounds UP
  to `"1000.0"`, rendering the literal **`"1000.0M"`** instead of promoting to **`"1.0B"`**.

### Evidence (RED → GREEN)

Reproduced the pre-fix behavior directly (copy of the original inline function, run standalone):

```
999_600 (K->M):        1000K
999_950_000 (M->B):    1000.0M
```

New regression tests (`src/features/vector/lib/vector-crosshair-format.test.ts`) assert the
correct, promoted output for both boundaries plus a set of non-boundary and exact-boundary values
to guard against a precision regression:

```
assert.equal(fmtGex(999_600), "1.0M");
assert.equal(fmtGex(999_950_000), "1.0B");
assert.equal(fmtGex(999_600_000), "999.6M");   // genuinely under the M->B boundary, unchanged
```

Ran against the pre-fix inline logic: 1 failure (`"999.6M"` where `"1.0B"` was expected — proving
the test catches the exact described defect). Ran against the fixed, extracted module: 5/5 pass.

### Blast radius

Single call site: `renderVectorCrosshairLegend`'s GEX line (`VectorCrosshairLegend.tsx:94`
pre-fix). No other file defines or imports this `fmtGex`. The companion `fmtStrike` in the same
file has no unit-boundary logic and is unaffected.

### Fix rationale

Extracted the pure formatting logic to a new sibling module,
`src/features/vector/lib/vector-crosshair-format.ts`, following the same pattern already used for
`vector-age-format.ts`/`vector-compare-format.ts` in this feature area — the component is painted
imperatively into a ref with no render harness (CLAUDE.md lesson #3), so the pure math needs to
live outside the `.tsx` file to be exercised by the plain Node test runner directly.

Applied the same round-first-then-promote guard already shipped this session for the identical bug
class elsewhere in the repo (`fmt-money.ts`'s `fmtPremium`, `helix-flow-format.ts`'s `fmtOi`,
`meridian-revenue-format.ts`'s `fmtCompactRevenue`, `thermal-discord-card.ts`'s
`fmtCompactHeatMoney`, `darkpool-discord-format.ts`'s `fmtShares`, among others): compute the
candidate unit's rounded magnitude, matching that unit's own `.toFixed()` precision, **before**
deciding whether it crossed into the next unit, and promote when it did. Precision at each tier
(B: 1dp, M: 1dp, K: 0dp) is unchanged from the original, so no display format shifts for values
that were never near a boundary. No tier beyond B was added — the original formatter never had a
T tier, and this fix does not change that scope.

This exact file/function was explicitly flagged and deliberately deferred in an earlier round's
commit message (`a99563b76`, fixing the sibling Meridian revenue formatters) as "the same bug
class and IS live, but is a different feature area — deliberately left for a future round." This
is that follow-up.

### Confidence check — pattern NOT yet fully exhausted

A fresh repo-wide grep for the same K/M/B unit-boundary shape (excluding this session's already-
fixed files and the excluded engine areas) turned up three more live, unfixed instances worth a
future round:

- `src/features/thermal/components/GexHeatmap.tsx` (~line 407) — local `fmtMoney`-shaped
  formatter, no round-first-then-promote guard present.
- `src/features/helix/components/HelixTideBar.tsx`'s `fmtMoney` (line 8) — same raw-threshold
  shape, no guard.
- `src/features/helix/components/ContractDrilldownDrawer.tsx`'s `fmtNotional` (line 98) — same
  shape, no guard.

None of these were touched in this PR (kept single-issue per the standing PR write-up policy);
flagging them here so they aren't lost, per the same discipline the deferred-fmtGex note itself
modeled.
