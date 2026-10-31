> **kind:** FINDING

## `gex-matrix-delta.ts`'s array-cell-format branch compared strikes by RAW ARRAY INDEX instead of VALUE — FIXED

**Status:** Fixed in this PR (`fix/gex-matrix-delta-array-index`).

### Root cause

`calculateMatrixDelta` compares a `previous` and `current` `GexMatrix` snapshot strike-by-strike to
build the incremental SSE delta the hybrid cron+SSE heatmap broadcast model sends instead of the
full 168×14 matrix. `GexMatrix.gex` is typed to accept EITHER cell format — `number[][]` (array,
row-per-strike) or `Record<string, Record<string, number>>` (keyed by strike string) — and the
shared helper `getGexRow(cells, strikeIdx, strikeStr, expiries)` was supposed to handle both
identically. It did not:

```ts
function getGexRow(cells, strikeIdx, strikeStr, expiries): number[] {
  if (Array.isArray(cells)) {
    return cells[strikeIdx] ?? [];      // <-- indexes by POSITION
  }
  const strikeRecord = cells[strikeStr]; // <-- looks up by VALUE (strike key)
  ...
}
```

The caller loop iterates `current.strikes` and passes the SAME loop index `i` to `getGexRow` for
BOTH `current.gex` and `previous.gex`:

```ts
for (let i = 0; i < current.strikes.length; i++) {
  const strike = current.strikes[i];
  const prevRow = getGexRow(previous.gex, i, strikeStr, previous.expiries); // i is an index into CURRENT.strikes
  const currRow = getGexRow(current.gex,  i, strikeStr, current.expiries);
  ...
}
```

For the array branch this silently assumes `previous.strikes[i] === current.strikes[i]` for every
`i` — but the ONLY structural compatibility check in `calculateMatrixDelta` is
`previous.strikes.length !== current.strikes.length`. It never checks that the strikes at matching
indices are the same strike. A chain whose ATM strike window shifts by exactly one strike between
cron ticks (one strike rolls off the low end as spot moves, a new one appears at the high end) keeps
the same strike COUNT while the strike value AT a given index changes — so `getGexRow(previous.gex,
i, ...)` returns a DIFFERENT strike's row than the one `strike`/`strikeStr` name for this iteration.
The record-format branch never had this defect: `cells[strikeStr]` looks up by the actual strike
VALUE, immune to index drift — so the two branches of one "handles both formats identically" helper
had silently drifted apart, the exact bug shape (duplicated logic across two paths of the same
function) this sweep keeps finding in other files.

**Why not caught earlier:** `gex-matrix-delta.test.ts` only ever exercised the record-format branch
(every fixture's `gex` field is a plain object keyed by strike string). The array-format branch has
no caller anywhere else in the repo today (`heatmap-warm/route.ts` and `largo/gex-matrix-changes.ts`
both always construct `GexMatrix.gex` from `gexHeatmap.gex.cells`, which `polygon-options-gex.ts`
types and always builds as the record format) — so the defect was latent, reachable only through
the function's own public, exported, explicitly-dual-format type contract, not through today's one
production code path. It is still a real correctness bug in shipped, exported logic: any future
caller feeding the array format (the type signature explicitly promises support for it) gets silent
strike misattribution with no error, no warning, and no way to detect it from the output shape.

### Evidence

RED→GREEN, `src/lib/gex-matrix-delta.test.ts` (new test, `git stash` used to isolate the source fix
from the test while proving RED):

- **Before the fix:** a previous snapshot with strikes `[490, 495]` (array rows `[[1000],[2000]]`)
  and a current snapshot with strikes `[495, 500]` (array rows `[[2000],[3000]]`) — i.e. the window
  shifted by one strike and strike 495's own GEX did **not** change (2000 → 2000) — incorrectly
  reports strike 495 as updated: `assert.equal(s495, undefined, ...)` fails with
  `{ strike: 495, gex_call: 2000 }` actually returned (the bug comparing 495's row against 490's old
  row, a spurious 1000 "delta").
- **After the fix:** 8/8 tests pass — strike 495 (unchanged) is correctly excluded from
  `updated_strikes`, and strike 500 (genuinely new, with real GEX) is correctly included with the
  right value (`gex_call: 3000`), sourced by its own, correctly-matched row.
- Full `tsx --test` run of every `gex-*.test.ts` file (16 suites, 102 tests): 102/102 pass.
- `tsc --noEmit`: clean, no new errors.

### Blast radius

`getGexRow` is a single private helper with exactly one call site family (all three call sites
inside `gex-matrix-delta.ts`: the cross-snapshot comparison in `calculateMatrixDelta`, and the two
same-snapshot-only reads in `calculateMatrixDeltaFull`). The same-snapshot reads in
`calculateMatrixDeltaFull` were never actually broken (there, the loop index and the snapshot being
read are always the same matrix, so index and value always agreed by construction) — they are
updated here only for consistency with the corrected signature, not because they produced wrong
output before. No other file reimplements this strike-row lookup; `largo/gex-matrix-changes.ts`
(excluded from this sweep, owned by the Largo lane) imports `calculateMatrixDelta` itself rather
than `getGexRow`, so it inherits the fix for free without being touched.

### Fix rationale

Changed `getGexRow`'s signature from `(cells, strikeIdx, strikeStr, expiries)` to `(cells,
ownStrikes, strike, expiries)`: for the array branch, resolve the real row via
`ownStrikes.indexOf(strike)` — i.e. search the STRIKES ARRAY THAT ACTUALLY OWNS the `cells` being
read, exactly mirroring what the record branch already does by key. A strike absent from
`ownStrikes` now returns `[]` (no data for that strike in this snapshot) — the same honest-absence
behavior the record branch already has for a strike missing from its keys — rather than silently
reading an unrelated row. Deliberately did NOT add a new structural-compatibility check comparing
`previous.strikes` and `current.strikes` by value in `calculateMatrixDelta` (e.g. rejecting the pair
outright on any strike-set mismatch): a shifting ATM window between ticks is normal, expected
behavior, not a malformed pair, and the fix above already makes BOTH cell formats handle a partial
strike-set overlap correctly (missing strike → treated as having no prior data, which is the truth).
