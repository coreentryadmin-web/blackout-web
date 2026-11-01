> **kind:** FINDING

## GEX call_wall/put_wall tie-break was insertion-order-dependent, not gamma-dependent — FIXED

| | |
|---|---|
| **Area** | `src/lib/providers/gex-cross-validation-core.ts` — `wallsFromStrikeTotals` + `gexWallsFromStrikeTotals` |
| **Severity** | P3 (visible flicker risk on the primary published GEX levels, same class as a prior fixed bug) |
| **Status** | Fixed |

### Root cause

`wallsFromStrikeTotals` (the shared helper that produces the canonical `call_wall`/`put_wall`
every GEX surface serves — Thermal, Vector, the SPX desk, Largo, the public Gamma Snapshot) and
its unconstrained client-side sibling `gexWallsFromStrikeTotals` both scanned
`Object.entries(strikeTotals)` **without sorting first**, tracking the argmax-positive and
argmin-negative strike with a strict `g > maxPos` / `g < maxNeg` comparison.

That comparison is correct when no two strikes are exactly tied. On an exact tie it keeps
whichever strike `Object.entries()` happened to enumerate *first* — and for non-integer-index
string keys (SPX's 0.5-wide strikes like `"7700.5"`), JS enumerates them in **insertion order**,
not numeric order. Insertion order is an artifact of how the caller built the `strikeTotals`
object (which contracts/expiries were processed in what order), not a fact about the gamma data.
So a true tie can resolve to a *different* strike across two rebuilds of the identical GEX book,
purely from incidental object-construction order — reported to the member as a wall level that
changed even though nothing in the market did.

This is the **exact bug class already found and fixed for the sibling function
`kingFromStrikeTotals`** (same file) — that fix's own doc comment describes it precisely
("a near-tied king node could then flicker between two strikes across rebuilds purely from
incidental key-insertion order, not from gamma actually moving"). `kingFromStrikeTotals` was
given a sort-before-scan fix with regression tests; `wallsFromStrikeTotals` and
`gexWallsFromStrikeTotals` — which produce the far more consequential, headline `call_wall`/
`put_wall` resistance/support levels — were never given the same fix, and had no tie-break test
at all.

### Evidence

Confirmed live with a minimal repro (`wallsFromStrikeTotals` before the fix):

```js
const a = { "7700.5": 1000000, "7750.5": 1000000 }; // tie, 7700.5 inserted first
const b = { "7750.5": 1000000, "7700.5": 1000000 }; // same data, 7750.5 inserted first

wallsFromStrikeTotals(a, 7600); // { callWall: 7700.5, putWall: null }
wallsFromStrikeTotals(b, 7600); // { callWall: 7750.5, putWall: null }
```

Identical gamma data, different reported call wall, purely from object key insertion order.

New regression tests in `gex-cross-validation-core.test.ts`:
- `wallsFromStrikeTotals: exact tie between two strikes always keeps the LOWER one, regardless of insertion order` (call side + put side)
- `wallsFromStrikeTotals: tie-break determinism holds under the spot side-constraint too`
- `gexWallsFromStrikeTotals: exact tie between two strikes always keeps the LOWER one, regardless of insertion order`

RED→GREEN verified: with the fix reverted (`git stash` on the source file only), the three new
tests fail (34 pass / 3 fail); with the fix restored, `gex-cross-validation-core.test.ts` is
37/37 green.

### Blast radius

`wallsFromStrikeTotals` is imported directly by: `gex-positioning.ts` (the canonical cross-product
positioning contract's `call_wall`/`put_wall`/`nearest_wall`), `gex-intraday-adjust-core.ts`
(the 0DTE intraday-adjusted wall recompute), `uwLevelsFromLadder`/`crossValidateGexLevels` in this
same file (the UW cross-validation oracle), `polygon-options-gex.ts` (`computeGexRegime`, the base
matrix), `spx-odte-gex-uw-overlay.ts`, and `wallsByHorizon`. `gexWallsFromStrikeTotals` is the
unconstrained sibling consumed by Thermal's per-expiry Key Levels
(`src/features/thermal/lib/gex-heatmap/per-expiry-levels.ts`, `recompute-levels.ts`). Every one of
these call sites inherits the fix automatically — no other call site re-implements the scan, so
nothing else needed a separate change.

### Fix rationale

Mirrored `kingFromStrikeTotals`'s already-established fix exactly: sort `Object.entries()`
ascending by numeric strike before scanning, so an exact tie deterministically keeps the LOWER
strike on every call regardless of insertion order. Did not change the comparison operators
(`>`/`<` stay strict) or any other logic — the sort only changes which of two *exactly tied*
candidates wins; every non-tied case is byte-identical to before. Left `kingFromStrikeTotals`
itself untouched (already correct) and did not touch the ranked-ladder `gex-wall-levels.ts`
implementation, which uses an unrelated, already-deterministic approach.
