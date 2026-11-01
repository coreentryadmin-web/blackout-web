> **kind:** FINDING

## Meridian `summarizeHeatmapGammaByExpiry` picked `pinned_expiry` non-deterministically on an exact gamma tie — FIXED

| | |
|---|---|
| **Area** | Meridian — earnings/event dealer-structure read (`src/lib/meridian/meridian-gex-reads.ts`) |
| **Status** | FIXED (regression test added, RED→GREEN proven) |
| **Severity** | P3 — correctness/determinism, narrow trigger window, no gate/money impact |

### Root cause

`summarizeHeatmapGammaByExpiry` sums near-spot dealer gamma per expiry into a `Map<string, number>`
(`byExpiry`), then picks the "pin contest" winner with:

```ts
const buckets = Array.from(byExpiry.entries())
  .map(...)
  .sort((a, b) => b.gamma - a.gamma);   // <- no tie-break
const top = buckets[0]!;
```

`Array.prototype.sort` is a **stable** sort, so when two expiries tie exactly on `gamma`, the
comparator returns `0` and the relative order of the tied elements is **whatever order they were
inserted into `byExpiry`**. That insertion order is determined by iterating `Object.values(cells)`
(the STRIKE rows) in whatever order the `cells` object's keys were enumerated — and for a
non-integer strike axis (e.g. SPX's `"7700.5"` shape, or any `.5`-wide chain), JS preserves
**insertion order**, not numeric order, for those string keys. So which strike's row the caller
happened to build first in `cells` — a detail with no market meaning whatsoever — silently decided
which of two equally-weighted expiries got reported as `pinned_expiry`, and therefore which expiry
name appeared in the headline (`"<expiry> pins NN% of dealer gamma"`).

This is the exact same argmax/argmin tie-break bug class already fixed in
`kingFromStrikeTotals`/`wallsFromStrikeTotals` (`gex-cross-validation-core.ts`, #7191/#7193),
`computeGexWalls` (`gex-wall-levels.ts`, #7207) and `topGexPinStrikes` (`strike-gex-lookup.ts`,
#7209) — all of which pre-sort `Object.entries(...)` by the numeric key before scanning so an exact
tie resolves deterministically instead of by incidental key-insertion order. `meridian-gex-reads.ts`
reimplements the same "pick the dominant bucket" shape independently, keyed by **expiry** instead of
**strike**, and never inherited the fix.

### Evidence

Reproduced live in this sandbox (`node --import tsx`) before the fix, with two `cells` payloads
describing the **identical** 50/50 gamma split across two expiries, differing only in which
strike's row comes first in the object literal:

```js
const cellsA = { "100.5": { "2026-01-01": 50 }, "200.5": { "2026-01-02": 50 } };
const cellsB = { "200.5": { "2026-01-02": 50 }, "100.5": { "2026-01-01": 50 } }; // same data, strike order swapped

summarizeHeatmapGammaByExpiry(cellsA, "2026-01-01").pinned_expiry; // "2026-01-01"
summarizeHeatmapGammaByExpiry(cellsB, "2026-01-01").pinned_expiry; // "2026-01-02"  <- different!
```

Added as a permanent regression test (`meridian-gex-reads.test.ts`): confirmed RED before the fix
(1 failure — the new test), GREEN after (9/9 pass), via a stash/pop of the source fix with the test
left in place.

### Blast radius

`summarizeHeatmapGammaByExpiry` has exactly one production caller, `meridian-event-brief.ts`
(`greekFromCells = summarizeHeatmapGammaByExpiry(hm?.gex?.cells, today)`), which feeds the earnings
event brief's dealer-gamma-by-expiry read (`pinned_expiry`/`pinned_pct`/`headline`). That caller
gets the fix automatically — no separate change needed there. No other file in the repo calls this
function.

### Fix rationale

Added a secondary sort key — ascending `expiry` string compare — exactly mirroring the established
convention ("sort ascending by the key before scanning, so a tie always resolves the same way"),
except the comparator itself (`.sort`) needed the tie-break, not a pre-sort of `Object.entries`,
since the scan here is an accumulation (sum), not an argmax loop — insertion order doesn't affect
the *sums* (addition is commutative), only which tied bucket lands first after the sort. Picking
the **earlier** expiry on a tie is deliberate, not arbitrary: it matches the function's own
"pin contest" framing (nearer expiries are the more actionable/relevant read when two are equally
weighted) and gives a stable, reproducible headline regardless of how the caller assembled `cells`.

Left unchanged: the sum/accumulation logic itself, the `pct_of_total`/`headline` formatting, and
every other function in the file (`maxPainForExpiryStrict`/`maxPainForExpiryFromHeatmap`), which do
not have an argmax/tie-break surface.
