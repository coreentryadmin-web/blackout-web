> **kind:** FINDING

## 0DTE thesis-health `pillarStatus()` mislabeled an unchanged pillar "faded"/never "lost" — FIXED

**Status:** Fixed, regression test added (`src/lib/zerodte/thesis-health.test.ts`).

### Root cause

`pillarStatus(commit, current)` (`src/lib/zerodte/thesis-health.ts`) is documented as
classifying how much a pillar has moved SINCE COMMIT, but its branches mixed an ABSOLUTE
level check (`current >= 0.75`, `current >= 0.45`) into what should have been a purely
RELATIVE comparison. Extracting the exact function and sweeping `commit === current`
("nothing moved") across `0.00..1.00`: every value `< 0.75` returned `"faded"` and every
value `>= 0.75` returned `"intact"` — `"lost"` was **unreachable** for an unchanged pillar no
matter how low its absolute score.

This is reachable in two concrete, non-contrived ways in `computeThesisHealth` (same file):

1. The cortex pillar is **always** `commit: cortexScore(commitCortex), current:
   cortexScore(commitCortex)` — the same call on the same frozen blob, by design ("honest
   static until live cortex ships"). Any committed row whose cortex decision is
   `THIN_EVIDENCE`/`CONTESTED`/`OPPOSE_UNRESOLVED`/`NET_NEGATIVE`/`VETO` scores `0`
   (`cortexScore`), so `pillarStatus(0, 0)` returned `"faded"` for the entire life of the
   position even though cortex never once moved.
2. More broadly, for any OPEN/HOLD/TRIM row whose ticker fell out of the live `board.setups`
   scan this cycle (`setup` is `null`), every other pillar's "current" falls back to its
   commit value verbatim (`liveFlow ?? commitFlow`, `setup ? ... : commitVwap`, `liveConf ??
   commitConf`, etc.), so `commit === current` for that whole cycle. Any such pillar whose
   commit score sat below 0.75 (a weak-confluence tier at 0.15, a neutral dealer regime at
   0.6, etc.) was labeled `"faded"` purely from its static absolute level.

Because `moves.push(...)` had no "did anything actually change" guard before appending a
line like `"Cortex: THIN_EVIDENCE → THIN_EVIDENCE"`, this reached two member-visible surfaces:
`ThesisHealthPanel.tsx` paints a persistent amber "weakened" (`~`) indicator for a pillar that
never moved, and `thesisManagementOverlay`'s SELL/TRIM recommendation text quotes
`health.moves[0]` directly — citing a pillar that never moved as the named reason to exit a
position that's actually unchanged.

Cross-checked against the sibling Swings implementation of the identical concept
(`pillarStatus` in `src/lib/swing/thesis-health.ts`), which is purely relative
(`if (currentCp >= commitCp - 5) return ... "intact"`, independent of absolute level) and was
NOT affected — confirming this is a real asymmetry between the two Night Hawk sub-products,
not an intentional design choice carried into the 0DTE version.

### Evidence

- Disposable repro (extracted the exact pre-fix branch logic and swept `pillarStatus(x, x)`
  for `x` in `0.00..1.00` step `0.01`): 75/101 values returned `"faded"`, 26/101 returned
  `"intact"`, 0/101 ever returned `"lost"` — confirming the bug exactly as described.
- **RED (pre-fix, reverted `pillarStatus` only, kept the new test):** the new regression test
  failed — `assert.equal(cortex!.status, "intact")` got `"faded"` — while the other 8 tests in
  `thesis-health.test.ts` still passed (confirming the new test, not an unrelated break, is
  what's RED).
- **GREEN (fix restored):** 9/9 tests in `thesis-health.test.ts` pass.
- `npx tsc --noEmit` clean on the whole project.
- Full `npm test` run clean (see PR for the exact pass count on this sandbox's documented
  Node-20 baseline).

### Blast radius

Only `pillarStatus` itself changed. It has exactly one caller
(`computeThesisHealth`, same file), which only consumes its return value for `pillar.status`
and the `moves[]` narrative lines — `health`/`rung`/`entryIndex`/`currentIndex`/`delta` are
all computed independently from the raw `currentScore`/`commitScore` weighted sums, never
from `status`, so this fix changes ONLY the status label and the narrative text, never the
headline health percentage or rung. Consumers downstream (`ThesisHealthPanel.tsx`,
`terminal-display.ts`, `thesisManagementOverlay`) read `pillar.status`/`moves` as opaque
values and are unaffected by the fix mechanically — they now just receive correct labels. No
other file reads `pillarStatus` (it is not exported).

### Fix rationale

Replaced the absolute-level-gated branches with the same purely-relative, centi-point
comparison the swing sibling already uses (`Math.round(commit * 100)` /
`Math.round(current * 100)`, then classify by the gap between them): `>= -5` centi-points is
`"intact"`/`"strengthened"`, `>= -20` is `"faded"`, otherwise `"lost"`. This guarantees
`commit === current` always yields `"intact"` (zero distance), fixing both the false
`"faded"` floor and the unreachable `"lost"` path, while preserving the function's real job
of classifying genuine movement (confirmed against the existing "VWAP cross drops health
materially" test, where a real commit=1→current=0 move still correctly classifies as
`"lost"`). Rejected: keeping an absolute-level component alongside a relative one (that was
exactly the bug — absolute level is already honestly reflected in `currentScore`'s
contribution to the weighted health percentage, so folding it into the relative "did this
change" label double-counts it and reintroduces the same false-positive risk at a different
threshold).

### Deliberately left unchanged

- `cortexScore`/`buildThesisWeightProfile`/the weighted `health` calculation — all already
  correct; this fix only touches the status/narrative classification layer.
- The swing sibling `pillarStatus` (`src/lib/swing/thesis-health.ts`) — already relative,
  used here only as the reference implementation to mirror, not touched.
- `ThesisHealthPanel.tsx`/`terminal-display.ts`/`thesisManagementOverlay` — all consume
  `status`/`moves` as given; no behavior change needed there, they now just receive correct
  inputs.
