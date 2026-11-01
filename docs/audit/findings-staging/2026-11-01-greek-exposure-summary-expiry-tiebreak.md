> **kind:** FINDING

## `summarizeGreekExposureByExpiry` picked `pinned_expiry` non-deterministically on an exact gamma tie — FIXED

| | |
|---|---|
| **Area** | Shared greek-exposure-by-expiry read (`src/lib/greek-exposure-summary.ts`), consumed by the SPX desk (`greek_exposure` field) and Largo's live feed (`largo-live-feed.ts`) |
| **Status** | FIXED (regression test added, RED→GREEN proven) |
| **Severity** | P3 — correctness/determinism, narrow trigger window (an exact gamma tie between two expiries), no gate/money impact |

### Root cause

`summarizeGreekExposureByExpiry` sums each row's gamma into a `Map<string, number>` keyed by
expiry (`byExpiry`), built by iterating the caller-supplied `rows` array in whatever order it
arrived in, then picks the "dominant expiry" with:

```ts
const buckets = Array.from(byExpiry.entries())
  .map(...)
  .sort((a, b) => b.gamma - a.gamma);   // <- no tie-break
const top = buckets[0]!;
```

`Array.prototype.sort` is a **stable** sort, so when two expiries tie exactly on summed `gamma`,
the comparator returns `0` and the relative order of the tied buckets is whatever order they were
inserted into `byExpiry` — which is simply the order the upstream UW greek-exposure/expiry rows
happened to arrive in. That ordering carries no market meaning at all, yet it silently decides
`pinned_expiry`, `pinned_pct`, and the member/Largo-facing `headline` string
(`"<expiry> pins NN% of dealer gamma"`).

This is the same argmax/argmin tie-break bug class already fixed, independently, four times this
session: `kingFromStrikeTotals`/`wallsFromStrikeTotals` (`gex-cross-validation-core.ts`,
#7191/#7193), `computeGexWalls` (`gex-wall-levels.ts`, #7207), `topGexPinStrikes`
(`strike-gex-lookup.ts`, #7209), and `summarizeHeatmapGammaByExpiry` (`meridian-gex-reads.ts`,
#7210) — all of which pre-sort or add a tie-break key before picking the dominant bucket.
`greek-exposure-summary.ts` is a FIFTH, independent reimplementation of the exact same "sum a
greek by expiry, pick the dominant bucket" shape (this time keyed by the raw `rows` array's own
order rather than an `Object`/`cells` key-enumeration order), and never inherited any of those
fixes — it is a different file with a different caller set (SPX desk's `greek_exposure` field and
Largo's `largo-live-feed.ts`), not a duplicate of one already fixed.

### Evidence

Reproduced live in this sandbox (`node --import tsx`) before the fix, with two row arrays
describing the **identical** 50/50 gamma split across two expiries, differing only in which row
comes first:

```js
const rowsA = [
  { expiry: "2026-01-02", net_gamma: 1_000_000 },
  { expiry: "2026-01-01", net_gamma: 1_000_000 },
];
const rowsB = [
  { expiry: "2026-01-01", net_gamma: 1_000_000 },
  { expiry: "2026-01-02", net_gamma: 1_000_000 },
];

summarizeGreekExposureByExpiry(rowsA, "2026-01-05").pinned_expiry; // "2026-01-02"
summarizeGreekExposureByExpiry(rowsB, "2026-01-05").pinned_expiry; // "2026-01-01"  <- different!
```

Added as a permanent regression test (`greek-exposure-summary.test.ts`, new file — the module had
no prior test coverage at all): confirmed RED before the fix (1 of 3 new tests failing — the
tie-determinism assertion), GREEN after (3/3 pass), via a `git stash`/`pop` of the source change
with the tests left in place.

### Blast radius

`summarizeGreekExposureByExpiry` has exactly two production call sites, both of which get the fix
automatically with no separate change needed:
- `src/features/spx/lib/spx-desk.ts` (two call sites) — feeds the desk payload's
  `greek_exposure` field, including its `headline` string.
- `src/lib/largo/largo-live-feed.ts` — feeds the same summary into Largo's live feed read.

No other function in `greek-exposure-summary.ts` has an argmax/argmin surface (the only other
logic, `num()`, is a simple first-match field reader with no ordering dependency).

### Fix rationale

Added a secondary ascending-expiry sort key to the existing `.sort`, matching the established
"deterministic tie-break" convention from the four sibling fixes named above:
`.sort((a, b) => b.gamma - a.gamma || a.expiry.localeCompare(b.expiry))`. Picking the EARLIER
(nearer) expiry on a tie matches this function's own "pin contest, nearer is more actionable"
framing (the function already special-cases today's expiry as `0DTE`) and makes the pick a pure
function of the gamma data again, independent of row arrival order. Left unchanged: the
accumulation logic (`byExpiry.set(exp, (byExpiry.get(exp) ?? 0) + g)` — addition is commutative, so
row order never affected the summed totals, only which tied bucket landed first after sorting) and
the `num()` field reader, which has no ordering concern.
