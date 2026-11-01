> **kind:** FINDING

## Meridian halo/dimension-rollup/orbital-layout: a signal's deliberate `weight: 0` was promoted to `weight: 1`, inflating neutral weight and diluting dimension intensity — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** round-259 discovery-lane sweep of `src/lib/meridian/meridian-viz-core.ts` (the
"asymmetric sibling-field guard" lens), following up on the file's own stated principle that
`Number(null) === 0` is a trap worth guarding against explicitly.

**Root cause:** three functions in the Meridian visualization layer resolve a signal's weight
with the same expression: `Math.abs(num(s.weight) ?? 1) || 1`
(`haloFromSignals` and `dimensionRollup` in `src/lib/meridian/meridian-viz-core.ts`;
`orbitalLayout` — twice — in `src/lib/meridian/meridian-spatial-core.ts`). The `?? 1` correctly
falls back to 1 when the weight is genuinely missing (`null`/`undefined`), but the trailing
`|| 1` additionally — and wrongly — promotes an explicit, honest `weight: 0` to `1`, because `0`
is falsy in JavaScript. This is the exact `Number(null) === 0` trap this file's own header
comment warns about, just run in the opposite direction: there a MISSING value silently becomes
a false zero; here a genuine ZERO silently becomes a false one.

`weight: 0` is not a hypothetical input. `src/lib/meridian/meridian-earnings-report-core.ts`'s
`buildMeridianEarningsReport` pushes exactly that — `{ lean: "neutral", weight: 0, score: 0 }` —
for three pillars on purpose: `news`, `vector`, and `insider`. These are informational-only rows
(a headline count, a chain-IV read, an insider-filing count) that the author deliberately scored
and weighted zero so they display in the report without swaying the verdict. The viz-core
helpers instead silently treated them as weight-1 real evidence.

**Blast radius — three consumers, all fed the same `signals` array:**
- `haloFromSignals` (the Report panel's halo ring): every zero-weight informational signal added
  1 to `neutralWeight`/`totalWeight`, which can tip `dominant` toward `"neutral"` when it
  shouldn't be, and gives each informational pillar a visible ring slice its own score/weight
  says it should not have.
- `dimensionRollup` (the five-dimension rollup, `MeridianEarningsReportPanel`): the `STRUCTURE`
  dimension's only two pillars are `thermal` (weight 2, always pushed) and `vector` (weight 0,
  pushed whenever Vector/chain-IV data is available). The bug read their combined weight as 3
  instead of 2 — understating `STRUCTURE.intensity` by a third (67 instead of 100, in the
  concrete case of a single unanimous `thermal` signal) any time Vector data loaded, which per
  the file's own `fetchNextEarningsDate`/positioning plumbing is common, not rare.
- `orbitalLayout` (the orbital diagram, `meridian-spatial.tsx`): weight feeds BOTH the node's
  own displayed `weight` field and the global min/max span used to place every node's `radius`
  (radius encodes inverse weight — heavier pillars sit closer to the centre). A zero-weight
  informational pillar could tie with, or sit closer than, a real but weak (weight-1) evidence
  pillar instead of reading as strictly less influential, misrepresenting "no evidential pull"
  as "equal to real weak evidence."

**Fix:** added one shared helper, `resolveSignalWeight(weight)`, in `meridian-viz-core.ts` that
distinguishes the two cases correctly (`num(weight) === null` → fallback to 1; otherwise
`Math.abs(num(weight))`, preserving a real 0), and replaced all four call sites (two in
`meridian-viz-core.ts`, two in `meridian-spatial-core.ts`) with it. One shared function rather
than three independently-patched expressions, so the three call sites cannot drift apart again
the way the original `Math.abs(num(w) ?? 1) || 1` expression was independently duplicated three
times in the first place.

**Fix rationale:** kept the weight-1 fallback for genuinely missing weight exactly as documented
("a present-but-unweighted signal still occupies the ring") — that half of the original behavior
is correct and intentional, and nothing about it changed. Only the `0 → 1` promotion was removed.

**Evidence (RED → GREEN):** added regression tests to `src/lib/meridian/meridian-viz-core.test.ts`
(`resolveSignalWeight`'s own unit test; a `haloFromSignals` case asserting a zero-weight neutral
signal contributes nothing to `neutralWeight`/`totalWeight`; a `dimensionRollup` case mirroring
the real `thermal`(2)+`vector`(0) STRUCTURE shape, asserting `intensity === 100` not `67`) and to
`src/lib/meridian/meridian-spatial-core.test.ts` (an `orbitalLayout` case with `thermal`(2),
`news`(0, informational), `dark_pool`(1, real weak evidence), asserting the zero-weight pillar's
own `weight` field stays `0` and its `radius` sits strictly outside the weight-1 pillar's).

RED (reverted only the two source files via `git stash`, kept the new tests): 4 failing —
`resolveSignalWeight` returned 1 for input 0; `haloFromSignals` read `neutralWeight: 1` instead
of `0`; `dimensionRollup` read `STRUCTURE.intensity: 67` instead of `100`; `orbitalLayout`'s
`news` node read `weight: 1` and tied `dark_pool`'s `radius` instead of sitting further out.

GREEN (fix restored): `npx tsx --experimental-test-module-mocks --test
src/lib/meridian/meridian-viz-core.test.ts src/lib/meridian/meridian-spatial-core.test.ts
src/lib/meridian/meridian-ladder-inversion.test.ts src/lib/meridian/meridian-orbital-panel-fit.test.ts
src/lib/meridian/meridian-thermal-scope.test.ts` → 155/155 pass, 0 fail. `npx tsc --noEmit`:
clean on the changed files.
