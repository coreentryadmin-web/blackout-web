# computeVexRegime picked an exact net-vanna tie non-deterministically (insertion-order dependent)

> **kind:** FINDING

| | |
|---|---|
| **Area** | GEX heatmap provider — VEX (dealer-vanna) regime (`src/lib/providers/polygon-options-gex.ts`) |
| **Severity** | P3 (correctness/consistency — published level, not board-breaking) |
| **Status** | **FIXED** |

## Root cause

`computeVexRegime` ranks strikes by net dealer vanna with an unsorted argmax/argmin scan:

```ts
for (const [s, v] of Object.entries(strikeTotals)) {
  const strike = Number(s);
  if (v > maxPos) { maxPos = v; posWall = strike; }
  if (v < maxNeg) { maxNeg = v; negWall = strike; }
}
```

The strict `>`/`<` comparisons mean an exact tie in `v` is never overwritten, so on an exact tie
the winner is whichever strike happened to be enumerated *first* by `Object.entries` — the
object's key order, not any property of the actual vanna data.

Per the ECMAScript integer-index-key rule, a plain object always enumerates canonical-integer
string keys ("100", "480") in ascending numeric order regardless of insertion order. Decimal
strike keys ("480.5" — the normal case for SPX/SPY's half-dollar-wide chain) are NOT
integer-index keys and instead preserve true **insertion** order. `strikeTotals` is built from
two different producers with two different insertion orders for the same strike set, in this
same file:

- `buildGexHeatmapUncached`'s `buildMetric` (~line 3700) inserts strikes **descending**
  (`strikes = Array.from(allStrikes).sort((a, b) => b - a)` before the insertion loop).
- `buildGexHeatmapFromUwStrikeExposures` (~line 3253, the UW-spot-exposures fallback used
  whenever the Polygon chain comes back empty) inserts in whatever order the upstream UW rows
  array returns them — unsorted, and not guaranteed to match the Polygon path's order.
- `prunePastExpiriesFromHeatmap`'s `pruneMetricCells` (~line 1488) inserts in whatever order
  `Object.entries(cells)` on the ALREADY-SERVED heatmap's `vex.cells` happens to return.

All three feed `computeVexRegime`, whose `posWall`/`negWall` are published straight onto the
heatmap as `vex.pos_wall`/`vex.neg_wall` (serialized at lines ~1587-1588, ~3325-3326, and
~4063-4064) — the published dealer-vanna support/resistance levels served to the GexHeatmap UI's
VEX panel and every API consumer. So the same exact tied pair of half-dollar strikes can report
opposite `pos_wall`/`neg_wall` across two otherwise-identical rebuilds purely because one was
built via the Polygon path and another via the UW fallback or a stale-heatmap prune pass — never
because the underlying vanna actually changed.

This is the same "argmax/argmin over `Object.entries` with no tie-break on non-integer keys"
defect class already fixed for `kingFromStrikeTotals`/`wallsFromStrikeTotals`
(`gex-cross-validation-core.ts`), `computeGexWalls` (`gex-wall-levels.ts`, PR #7207),
`topGexPinStrikes` (`strike-gex-lookup.ts`), `summarizeHeatmapGammaByExpiry` (PR #7210), and
`computeMaxPainFromChain` (PR #7211) — `computeVexRegime` (the VEX/vanna sibling of
`computeGexRegime`, which already carries the same sort-before-scan fix) was never migrated.

## Evidence

Reproduced directly (two `Record<string, number>` objects describing the identical tied book,
built in the two real insertion orders `buildMetric` and the UW fallback actually use):

```js
const descendingInsertion = { "110.5": 2_000_000, "105.5": -500_000, "100.5": 2_000_000 };
const ascendingInsertion  = { "100.5": 2_000_000, "105.5": -500_000, "110.5": 2_000_000 };
computeVexRegime(descendingInsertion, 1_500_000).posWall; // => 110.5  (pre-fix)
computeVexRegime(ascendingInsertion, 1_500_000).posWall;  // => 100.5  (pre-fix) — DIFFERENT, same book
```

Regression tests added: `src/lib/providers/polygon-options-gex.test.ts`,
`"computeVexRegime: exact positive-vanna tie is deterministic regardless of object insertion
order"` and the negative-vanna sibling. Confirmed RED pre-fix (temporarily reverted the sort,
ran `npx tsx --experimental-test-module-mocks --test
src/lib/providers/polygon-options-gex.test.ts` — both new assertions failed, actual `110.5` vs
expected `100.5`), GREEN post-fix — full file suite 76/76, `tsc --noEmit` clean.

## Blast radius

`computeVexRegime` has exactly three call sites, all in this file, all serializing its
`posWall`/`negWall` onto the served `GexHeatmap.vex.pos_wall`/`vex.neg_wall`:
`prunePastExpiriesFromHeatmap` (~line 1524, the stale-heatmap prune path),
`buildGexHeatmapFromUwStrikeExposures` (~line 3274, the UW-fallback build path), and
`buildGexHeatmapUncached` (~line 3880, the primary Polygon-chain build path). All three were
fixed by the one change, since they all call the same function. The sibling
`computeDexRegime`/`computeCharmRegime` were checked and are NOT exposed to this bug — they take
a single scalar `total` (not a `strikeTotals` record) and never scan/rank strikes, so they have
no tie-break surface.

## Fix rationale

Sort `Object.entries(strikeTotals)` ascending by strike before the argmax/argmin scan, matching
the established convention already shipped for `kingFromStrikeTotals`/`wallsFromStrikeTotals`/
`computeGexRegime`'s own call wall/put wall scan: a tie deterministically keeps the **lower**
strike, on every call, regardless of how `strikeTotals` was built. This keeps the whole codebase
resolving this exact tie shape the same way everywhere it occurs, rather than inventing a
different convention for VEX.

Deliberately left unchanged: the upstream insertion-order asymmetry itself (the three producers
listed above still insert in different orders) — fixing the symptom at the shared ranking
function is strictly more robust than trying to make every producer agree on an insertion order,
matching how every prior instance of this vein was fixed (at the consuming scan, not the
producer). Also left unchanged: `computeDexRegime`/`computeCharmRegime` (no tie-break surface,
confirmed above) and the public export of `computeVexRegime` itself, which was only a visibility
change (`function` → `export function`, matching the already-exported `computeCharmRegime`
sibling) needed to add direct regression coverage — no behavior change for any existing caller.
