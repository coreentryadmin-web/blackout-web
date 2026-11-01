# topGexPinStrikes ranked an exact |GEX| tie non-deterministically (insertion-order dependent)

> **kind:** FINDING

| | |
|---|---|
| **Area** | Vector — pick scoring/evidence (`src/features/vector/lib/strike-gex-lookup.ts`) |
| **Severity** | P3 (correctness/consistency — scoring inputs, not board-breaking) |
| **Status** | **FIXED** |

## Root cause

`topGexPinStrikes` ranked strikes by `Math.abs(netGex)` with:

```ts
rows.sort((a, b) => b.abs - a.abs);
```

`Array.prototype.sort` is stable, so on an **exact** `|gex|` tie the winner is whichever strike
happened to appear first in `Object.entries(totals)` — i.e. the object's own insertion order, not
any property of the actual gamma data.

Integer-keyed strikes don't expose this: per the ECMAScript integer-index-key rule, a plain
object always enumerates integer-like string keys ("100", "575") in ascending numeric order
regardless of insertion order, which is exactly why the pre-existing sibling test
(`topGexPinStrikes: returns largest |GEX| strikes`, integer strikes only) never caught it. Real
index-scale/high-priced names (SPY, QQQ, SPX) trade half-dollar strikes ("100.5", "575.5"), which
are NOT integer-index keys and DO preserve true insertion order.

This repo builds the exact `strike_totals` record this function consumes via **two different
code paths with two different insertion orders for the same strike set**
(`src/lib/providers/polygon-options-gex.ts`):
- The primary Polygon-chain path (`buildMetric`, ~line 3703) always inserts strikes
  **descending** (`strikes = Array.from(allStrikes).sort((a, b) => b - a)` before the insertion
  loop).
- The UW-spot-exposures **fallback** path (`buildGexHeatmapFromUwStrikeExposures`, ~line 3232,
  used whenever the Polygon chain comes back empty for a ticker) inserts strikes in whatever
  order `fetchUwSpotExposuresByStrike`'s upstream rows array returns them — unsorted, and not
  guaranteed to match the Polygon path's order.

Both feed the identical `VectorPickEnrichment.strikeTotals` field
(`src/features/vector/lib/vector-pick-enrichment.ts:51`, `hm?.gex?.strike_totals`), which
`vector-play-candidates.ts:503` passes straight into `topGexPinStrikes(totals, 3)` to decide the
"+6, Strike sits on a top net-gamma pin in the matrix" scoring bonus and reason string on a Vector
play. So the SAME two tied half-strikes can rank in opposite order across two otherwise-identical
sessions purely because one session's heatmap was served from the Polygon chain path and another
from the UW fallback — never because the underlying gamma changed.

## Evidence

Reproduced directly (two `Record<string, number>` objects describing the identical tied book,
built in the two real insertion orders above):

```js
const descendingInsertion = { "110.5": 1_000_000, "105.5": -2_000_000, "100.5": 2_000_000 };
const ascendingInsertion  = { "100.5": 2_000_000, "105.5": -2_000_000, "110.5": 1_000_000 };
topGexPinStrikes(descendingInsertion, 1); // => [105.5]  (pre-fix)
topGexPinStrikes(ascendingInsertion, 1);  // => [100.5]  (pre-fix) — DIFFERENT, same book
```

Regression test added: `src/features/vector/lib/strike-gex-lookup.test.ts`,
`"topGexPinStrikes: exact-|GEX| tie is deterministic regardless of object insertion order"`.
Confirmed RED pre-fix (`git stash` the fix, run `npx tsx --experimental-test-module-mocks --test
src/features/vector/lib/strike-gex-lookup.test.ts` — assertion failed, actual `[105.5]` vs
expected `[100.5]`), GREEN post-fix.

## Blast radius

Single call site consumes `topGexPinStrikes`: `vector-play-candidates.ts:503`
(`pins.includes(contract.strike)` → +6 score / "top net-gamma pin" reason on a ranked Vector
pick). `strikeGexFromTotals` (the sibling export in the same file) was audited too — it only
looks up one specific strike's value by exact/rounded key match, never ranks or compares across
strikes, so it has no tie-break surface and was left unchanged.

This is the same "argmax/argmin over `Object.entries` with no tie-break on non-integer keys"
defect class as the already-fixed `kingFromStrikeTotals`/`wallsFromStrikeTotals`
(`gex-cross-validation-core.ts`) and `computeGexWalls` (`gex-wall-levels.ts`, PR #7207) — this is
a third, independently-discovered instance of the same vein, in a file neither of those PRs
touches.

## Fix rationale

Added a secondary sort key — `a.strike - b.strike` when `|gex|` is exactly equal — so an exact
tie deterministically keeps the **lower** strike, on every call, regardless of how `totals` was
built. This matches the established convention already shipped in
`kingFromStrikeTotals`/`wallsFromStrikeTotals` (sort ascending by strike before the argmax scan,
lower strike wins ties), so the whole codebase now resolves this exact tie shape the same way
everywhere it occurs, rather than inventing a fourth convention.

Deliberately left unchanged: the upstream insertion-order asymmetry itself
(`buildMetric`'s strike-descending insert vs `buildGexHeatmapFromUwStrikeExposures`'s raw-row
insert) — fixing the symptom at the shared ranking function is strictly more robust than trying
to make every producer agree on an insertion order, and matches how the two prior instances of
this vein were fixed (at the consuming scan, not the producer).
