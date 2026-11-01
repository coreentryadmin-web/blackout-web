> **kind:** FINDING

## Scoped matrix DR% hid a genuinely measured "no change" strike as "no data" — FIXED

**Status:** Fixed, regression tests added (`src/lib/gex-shift-scope.test.ts`).

### Root cause

`matrixShiftDeltaForStrikeScoped` (`src/lib/gex-shift-scope.ts`) computes a per-strike net-gamma
shift for the SCOPED (single-DTE / 0DTE / near-term / monthly) matrix view by diffing the current
cells against `baseline_cells` for only the selected expiry columns, then did:

```ts
const d =
  sumMetricCellsForExpiries(cells[key], selectedExpiries) -
  sumMetricCellsForExpiries(baseline[key], selectedExpiries);
if (!Number.isFinite(d) || d === 0) return undefined;
return d;
```

`sumMetricCellsForExpiries` defaults a missing row to `0` (by design — it is also used for honest
partial sums). That means **two completely different situations produce the exact same `d === 0`**:
a strike with genuinely NO data on either side of the diff (nothing to measure), and a strike with
REAL data on both sides whose net change over the scoped window happens to be exactly zero (a real,
measured "flat" reading). The old code could not tell them apart and collapsed both to `undefined`
— the exact "absence published as measurement" failure mode this codebase's own `flow-gex-proximity.ts`
module (`gex_evaluated`) was built to prevent for a sibling signal, just not applied here.

The sibling **unscoped** path, `matrixShiftDeltaForStrike` (`src/lib/gex-shift-leaders.ts`), does
NOT have this bug — `d != null && Number.isFinite(d)` happily returns a real `0`. The module's own
doc comment says the scoped and unscoped lenses use "same % math as SPX Slayer", but they
disagreed on this exact case. Further corroborating evidence that a real zero was always meant to
reach callers: `ThermalCompactMatrix.tsx`'s own tone logic reads
`shiftDelta != null && shiftDelta >= 0` (inclusive of zero, not `> 0`) — a caller that already
anticipates a legitimate `0` arriving, which this function never let through.

### Effect on the live UI

Every caller of `matrixShiftDeltaForStrikeScoped` (`GexHeatmap.tsx` ×2, `ThermalCompactMatrix.tsx`,
`vector-odte-matrix-rows.ts`, and SPX Slayer's own `SpxGexMatrixHeatmap.tsx`, which shares this same
file) feeds the result straight into `shiftPercentForStrike`/`fmtShiftPercentForStrike`, which
return `null`/`"—"` for a `null`/`undefined` delta. So a strike whose scoped net gamma was flat
over the shift window rendered **no DR% chip at all** (or `"—"`) — visually identical to a strike
the baseline never covered — instead of the correct, honest `"+0%"` / `"0%"`.

### Evidence

- **RED (pre-fix, via `git stash` on `gex-shift-scope.ts` only, new tests kept):** the new
  "returns a real 0 (not undefined) for a measured, unchanged strike" test failed —
  `undefined !== 0` — against the unmodified function. The other 3 new tests already passed
  (confirming they test genuinely different, already-correct behavior).
- **GREEN (fix restored):** all 8 tests in `gex-shift-scope.test.ts` pass (`npx tsx
  --experimental-test-module-mocks --test src/lib/gex-shift-scope.test.ts`, Node 20).
- Sibling suites unaffected: `gex-shift-leaders.test.ts` (22 tests) and
  `src/features/thermal/lib/gex-heatmap/shift-math.test.ts` all still pass.
- `npx tsc --noEmit` clean.

### Blast radius

`matrixShiftDeltaForStrikeScoped` is a single shared helper consumed by: Thermal's `GexHeatmap.tsx`
(both the king-cell tooltip computation and the main matrix DR% column), `ThermalCompactMatrix.tsx`,
Vector's `vector-odte-matrix-rows.ts`, and SPX Slayer's `SpxGexMatrixHeatmap.tsx` (same shared file,
not a separate implementation) — every one of these inherits the fix automatically, and every one
of them was exhibiting the same silent-chip-drop symptom for a flat strike in scoped view.

### Fix rationale

Added `hasScopedCoverage(row, expiries)` — true when at least one selected-expiry cell on that row
is a real, finite number (as opposed to `sumMetricCellsForExpiries`'s deliberate default-to-0 for an
absent row). `matrixShiftDeltaForStrikeScoped` now returns `undefined` only when NEITHER side has
coverage for the scope (genuinely nothing to diff); once either side has real data, the computed
diff — including a real `0` — is returned as-is. This preserves the original "return undefined on no
baseline at all" early-out and the original partial-sum behavior of `sumMetricCellsForExpiries`
(untouched), and only changes the final absence/zero decision.

Considered and rejected: changing `sumMetricCellsForExpiries` itself to distinguish "no data" from
"zero" via a richer return type — a larger, non-additive change to a function whose current
partial-sum behavior is correct and used elsewhere; the ambiguity only matters at the point this
function decides whether to publish `undefined`, so the fix is scoped to exactly that decision.

### Deliberately left unchanged

- `sumMetricCellsForExpiries`'s own default-to-0 behavior for a missing row — correct for partial
  sums, untouched.
- `matrixShiftDeltaForStrike` (unscoped path) — already correct, not touched.
- `shiftPercentForStrike` / `fmtShiftPercentForStrike` / `wallStrengthShift` — already correctly
  treat a real `0` delta as a real `0%`; the bug was entirely upstream of them.
