> **kind:** FINDING

## `pickGexShiftLeaders` ranked an exact |delta| tie non-deterministically on non-integer strikes — FIXED

| | |
|---|---|
| **Status** | Fixed |
| **File** | `src/lib/gex-shift-leaders.ts` |
| **Fix PR** | (this PR) |

### Root cause

`pickGexShiftLeaders` built its strike rows by iterating a `Set<number>` derived from
`Object.keys(opts.cells)` (scoped path) or `Object.keys(shift.delta_by_strike)` (unscoped path),
in whatever order those keys enumerated, then ranked the rows with:

```ts
rows.filter((r) => r.delta > 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, perSide)
```

`Array.prototype.sort` has been stable since ES2019: on an **exact** `|delta|` tie, the two rows
keep whatever relative order they were pushed in — i.e. whichever key `Object.keys()` enumerated
first.

That enumeration order is not uniform across key shapes, per the JS spec. Integer-index-like keys
(`"100"`, `"6800"`) always enumerate in ascending numeric order **regardless of the source
object's insertion order**, so the bug is invisible on whole-dollar strikes. SPX's real
half-strikes (`"100.5"`, `"7700.5"`) are *not* integer-index keys and enumerate in **insertion
order** instead — a direct function of whatever order the caller's `cells` / `delta_by_strike`
object happened to be built in upstream (e.g. the live WS ladder's trade-arrival order, or how a
merge/rebuild assembled the map that tick). Two independently-rebuilt computations of the
identical shift book, differing only in that insertion order, can rank a tied half-strike pair in
opposite order — surfacing to a member as a shift-leader badge "flipping" sides on a matrix cell
when nothing in the market actually moved.

### Evidence

Reproduced directly against the real, unmodified `pickGexShiftLeaders`: two `delta_by_strike`
objects describing the identical book — 100.5 and 105.5 each at exactly the same `|delta|`
(500,000) — built with the two keys inserted in opposite order:

```
deltaLowFirst  = { "100.5": 500000, "105.5": 500000, "95": -400000 }
deltaHighFirst = { "105.5": 500000, "100.5": 500000, "95": -400000 }

pickGexShiftLeaders(totals, { available: true, delta_by_strike: deltaLowFirst  }) -> calls [100.5, 105.5]
pickGexShiftLeaders(totals, { available: true, delta_by_strike: deltaHighFirst }) -> calls [105.5, 100.5]
```

Same book, same tie, opposite rank order purely from source-object construction order. Confirmed
this does **not** reproduce with whole-dollar strikes (`"100"`/`"105"`), consistent with the
integer-index-key enumeration rule above.

This is the same bug class already fixed, earlier the same day, across this lane's other
exact-tie rankers that iterate strike maps: `wallsFromStrikeTotals`/`kingFromStrikeTotals`
(`gex-cross-validation-core.ts`, #7191), `scopeStructureToExpiry`
(`meridian-event-expiry-core.ts`, #7193), `computeGexWalls` (`gex-wall-levels.ts`, #7207),
`topGexPinStrikes` (`strike-gex-lookup.ts`, #7209), `summarizeHeatmapGammaByExpiry`
(#7210), `computeMaxPainFromChain` (#7211), `computeVexRegime` (#7212), and `deriveWalls`
(`heatmap-verifier.ts`, #7213) — `pickGexShiftLeaders` never received the same propagation despite
reading the exact same strike-keyed shape.

### Blast radius

`pickGexShiftLeaders` (and its wrapper `pickGexShiftLeaderCells`, which maps each leader onto its
dominant expiry column) backs:
- `GexShiftLeadersStrip.tsx` / `GexMatrixShiftBadge.tsx` — the Thermal matrix's inline shift badges
- `ThermalCompactMatrix.tsx`, `SpxGexMatrixHeatmap.tsx`, `VectorOdteMatrixRail.tsx` — the Thermal/
  SPX/Vector matrix rails that all share this one ranker
- `thermal-discord-extras.ts` — the Discord GEX card's shift-leader lines

Every one of these consumes whatever order `pickGexShiftLeaders` returns on a tie.

### Fix rationale

Sort the deduped strike keys ascending by numeric value **before** the row-building loop, matching
the established sibling fix pattern. Because the subsequent `|delta|`-descending sort is stable,
pre-sorting by strike makes an exact tie deterministically keep the LOWER strike first, regardless
of the source object's insertion order — the same convention every sibling ranker above now
follows. Left unchanged: the `|delta|`-descending ranking itself, the scoped-vs-unscoped delta
resolution (`matrixShiftDeltaForStrikeScoped`/`matrixShiftDeltaForStrike`), and every downstream
consumer's own logic.

### Evidence of fix (RED → GREEN)

- RED (pre-fix, `git stash` on `src/lib/gex-shift-leaders.ts` only): new test in
  `gex-shift-leaders.test.ts` — 8 pass / 1 fail (`callsHighFirst` returned `[105.5, 100.5]`,
  expected `[100.5, 105.5]`).
- GREEN (post-fix): 9/9 in that file; full consumer sweep (`gex-shift-leaders.test.ts`,
  `gex-shift-scope.test.ts`, `vector-odte-matrix-rows.test.ts`, every Thermal component test):
  34/34 pass. `tsc --noEmit` clean.
