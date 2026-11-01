> **kind:** FINDING

# `computeMaxPainFromChain` resolves an exact pain tie to the higher-OI strike, not the lower one

| | |
|---|---|
| **Area** | GEX heatmap / positioning — `src/lib/providers/polygon-options-gex.ts` |
| **Severity** | P3 (narrow-window correctness bug: wrong published Max Pain level on an exact tie) |
| **Status** | **FIXED** |

## Root cause

`computeMaxPainFromChain` builds its candidate rows from `summarizeOiByStrike(contracts, 500)`
and then scans that array directly for the minimum-pain strike:

```ts
const byStrike = summarizeOiByStrike(contracts, 500);
...
for (const candidate of byStrike) {
  let pain = 0;
  for (const row of byStrike) { ... }
  if (pain < bestPain) { bestPain = pain; bestStrike = candidate.strike; }
}
```

`summarizeOiByStrike` sorts its own return array by **descending `total_oi`** — a sort order that
exists purely for *that* function's own OI-ranked-display callers (e.g. `run-tool.ts`'s Largo OI
summary) and has nothing to do with strike price. `computeMaxPainFromChain` never re-sorts before
its argmin scan, so it iterates candidates in OI-descending order.

The argmin loop uses a **strict** `pain < bestPain` comparison — the first candidate visited wins
any exact tie. Combined with the OI-descending iteration order, this means: on an exact pain tie
between two strikes, the winner is **whichever strike happens to carry more total open interest**,
not any principled rule (lowest strike, closest to spot, etc.). The published "Max Pain" level for
that tie can therefore change from one rebuild to the next purely because the *OI distribution*
shifted, even though the *pain* values that actually decide the answer stayed tied.

This is the exact same bug class CLAUDE.md's "vein #7" and `wallsFromStrikeTotals`'s own doc
comment (`gex-cross-validation-core.ts`) already describe and fixed for the call/put-wall scan:
"sorting first makes a tie deterministically keep the LOWER strike on every call, regardless of
how [the input] was built" — `computeMaxPainFromChain` just never got the same treatment.

## Evidence

Added a regression test (`src/lib/providers/polygon-options-gex.test.ts`) constructing a
synthetic chain with an exact, by-construction pain tie between strike 100 (100 call OI, 0 put OI)
and strike 110 (9900 call OI, 100 put OI — the large call OI at 110 is irrelevant to either
candidate's pain value and exists only to make strike 110's *total* OI dwarf strike 100's):

- `pain(100) = (110-100) * put_oi(110) = 1000`
- `pain(110) = (110-100) * call_oi(100) = 1000`

`total_oi(100) = 100`, `total_oi(110) = 10000`, so `summarizeOiByStrike` places the strike-110 row
first.

- **Before the fix:** `computeMaxPainFromChain(contracts)` returned **110** — the higher-OI strike
  won the tie purely because it was visited first in OI-descending order.
- **After the fix:** it returns **100** — the lower strike wins the tie deterministically,
  regardless of either strike's OI.

```
npx tsx --experimental-test-module-mocks --test src/lib/providers/polygon-options-gex.test.ts
```
RED (pre-fix): `AssertionError [ERR_ASSERTION]: 110 !== 100` on the new test.
GREEN (post-fix): all 75 tests in the file pass, including the new one and both of the file's
pre-existing `computeMaxPainFromChain` tests (single-expiry pain-minimization, cross-expiry
blending, empty-input).

## Blast radius

`computeMaxPainFromChain` is called from three sites in `polygon-options-gex.ts` — the main GEX
heatmap build (`buildGexHeatmapUncached`, line ~224, whole-chain max pain shown on Thermal/Vector),
the per-expiry max-pain map (`maxPainByExpiry`, line ~3778, used by the 0DTE-scoped expiry view),
and `buildPolygonPositioningBundle` (line ~4807, the Positioning tab's own max-pain field) — every
one of those surfaces inherits the same fix with no call-site change, because the function's
*output contract* (a single `number | null`) is unchanged; only which strike it returns on an
exact tie is corrected. `summarizeOiByStrike` itself is left untouched (its OI-descending sort is
correct and load-bearing for its own direct callers, e.g. `src/lib/largo/run-tool.ts`'s OI summary
— out of scope for this fix anyway, excluded by the Largo carve-out) — only
`computeMaxPainFromChain`'s internal scan order changed.

## Fix rationale

Sort a local copy of `byStrike` ascending by strike before the argmin scan, leaving
`summarizeOiByStrike`'s own return value and sort order untouched for its other callers. This
mirrors `wallsFromStrikeTotals`'s already-shipped fix for the identical bug shape (unconstrained
argmax/argmin over an OI/insertion-ordered collection, not a strike-ordered one) rather than
inventing a new convention — "the lower strike wins an exact tie" is now the one rule this
codebase uses everywhere this bug class shows up. An alternative (biasing the tie toward the
strike closest to spot) was considered and rejected: `computeMaxPainFromChain` doesn't take `spot`
as a parameter today, and threading it through would widen this fix's blast radius into every call
site's signature for a tie that, by definition, two strikes already have equally strong pain-based
claims to — a cheap, deterministic rule is enough to kill the flicker without an unnecessary
signature change.
