> **kind:** FINDING
## Largo `gexMatrixChangesForLargo` misattributed a GEX move to the wrong strike when the heatmap's strike window shifted — FIXED

### Root cause
`src/lib/largo/gex-matrix-changes.ts`'s `rowSum()` helper, used by `gexMatrixChangesForLargo`
("Thermal matrix wall-build" card for Largo tool-use), is a second, independent reimplementation
of the same strike-row comparison `src/lib/gex-matrix-delta.ts`'s `getGexRow()` already does for
the SSE matrix-delta feed. The array-cell-format branch of this file's `rowSum` indexed `cells`
with the CALLER's loop index — derived from iterating `current.strikes` — and applied it
directly to whichever matrix (`previous.gex` or `current.gex`) was passed in:

```ts
for (let i = 0; i < current.strikes.length; i++) {
  const strike = current.strikes[i]!;
  const strikeStr = String(strike);
  const prevSum = rowSum(previous.gex, i, strikeStr, previous.expiries); // BUG: `i` is CURRENT's index
  const currSum = rowSum(current.gex, i, strikeStr, current.expiries);
  ...
```

That is only correct when `previous.strikes[i] === current.strikes[i]` for every `i`. Nothing in
this function checks that. `polygon-options-gex.ts` builds the strikes axis as a band AROUND
SPOT (see that file's own `±6%`/`±20%` comments), so between two warm cron ticks the window can
shift by one strike — one strike rolls off the low end, a new one appears at the high end —
while the strike COUNT stays identical. In that case the array branch silently sums a
*different* strike's row than the one `strike` names, misattributing a GEX change to the wrong
strike (or missing a real one), which this card then surfaces to Largo/members as a "wall
building" signal.

### Blast radius — the exact bug this repo already fixed once, duplicated
`src/lib/gex-matrix-delta.ts`'s `getGexRow` had and fixed this **identical** bug (PR #7095,
"array-cell-format branch matched strikes by index, not value") — the fix there was never
carried across to this Largo sibling, because the two files independently reimplement the same
strike-row-sum logic instead of sharing it. This is the "duplicated logic drifted out of sync
across sibling desk components" failure mode by name: one copy got the fix, the other did not.

Like the original #7095 fix, this is **currently latent via the one production caller**: the
cron (`heatmap-warm/route.ts`) that writes the `gex-matrix-snapshot:<ticker>` cache entry this
function reads as `previous` always builds `gex: gexHeatmap.gex.cells`, and `GexHeatmap.gex.cells`
is typed/produced as `Record<string, Record<string, number>>` (the record branch) today — never
the raw array format. `rowSum`'s type signature advertises support for both formats though (the
same union `GexMatrix.gex` carries), so the array branch is live, reachable code, not dead code
behind an unreachable type — exactly the same justification the prior #7095 fix used for the
sibling file, and the same standard this repo already applied there.

### Evidence (RED → GREEN)
New test `src/lib/largo/gex-matrix-changes.test.ts`, mirroring `gex-matrix-delta.test.ts`'s own
shifted-window fixture: previous strikes `[490, 495]` with array cells `[[1000], [2000]]`,
current strikes `[495, 500]` with array cells `[[2000], [3000]]` — strike 495's own GEX did NOT
change (2000 → 2000), only the window shifted.

- **Pre-fix (`git stash` the production file, keep the test):** strike 495 was wrongly reported
  as an updated strike with `gex_change: 1000, direction: 'stronger'` — it had been compared
  against strike 490's old row (`cells[0]`) instead of its own.
- **Post-fix:** strike 495 reports no change (correctly absent from `updated_strikes`); strike 500
  (genuinely new to the window) is reported with `gex_change: 3000, direction: 'flipped'`.
- A second test confirms the record-cell-format branch (the one path actually exercised in
  production today) was already correct and stays correct after the fix.
- `npx tsx --experimental-test-module-mocks --test src/lib/gex-matrix-delta.test.ts
  src/lib/largo/gex-matrix-changes.test.ts` — 10/10 pass.
- `tsc --noEmit` clean on the touched files.

### Fix rationale
Mirrored the exact fix already proven correct in `gex-matrix-delta.ts`'s `getGexRow`: resolve the
array-format row by `ownStrikes.indexOf(strike)` — searching the strikes array that actually owns
the `cells` being read — instead of trusting the caller's loop index. A strike absent from
`ownStrikes` now honestly returns `0` (no data for that strike in this snapshot), matching the
record branch's existing missing-key behavior, instead of silently reading an unrelated strike's
row. Deliberately did **not** collapse the two files into one shared helper in this PR — that is
a larger refactor (different return shapes: `MatrixDelta`'s per-strike call/put split vs this
card's signed `gex_change`/`direction`) better done as its own change; this PR scopes to the one
verified bug.

| **Status** | FIXED |
