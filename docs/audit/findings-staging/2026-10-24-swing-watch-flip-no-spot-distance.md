> **kind:** FINDING

## Night Hawk Swings: the "Watch levels" gamma-flip line — a separate, duplicate implementation of narrateFlip — had the same missing-distance gap — FIXED

**Status:** FIXED

### Root cause

`watchForSection` (`play-brief-intel.ts`) carries its own inline "Lose/Reclaim gamma flip $X" line
for the "Watch levels"/"What to watch" section — a separate implementation from `narrateFlip`
(`play-brief-narrative.ts`), which renders the conceptually identical fact for the sibling "Trade
manager read" section. Both exist because this codebase already has a documented history of
duplicate near-identical implementations (see this file's own dedup-fix comments), and both carried
the same gap this session already found and fixed twice elsewhere this hour: neither stated how
close spot currently is to the cited flip, even though both values needed to compute that distance
(`spot`, `flip`) were already resolved a few lines above the line itself.

4th instance of the exact same omission class found this session: #6641 (Entry trigger, this same
function), #6648 (Break watch, `play-brief-narrative.ts`), #6651 (narrateDarkPool/narrateKing/
narrateFlip, `play-brief-narrative.ts`), now this one.

### Evidence

Direct reading of the `watchForSection` gamma-flip branch (~line 2010) confirmed `spot`/`flip` are
both in scope and the sentence construction discarded them after the `spotAboveFlip` sign check.
Confirmed via `grep` that four existing tests in `play-brief-intel.test.ts` pin all four (direction
× spot-side) combinations with exact-string assertions, giving known, checkable expected values for
the fix.

### Fix

Added `` `(${Math.abs(((spot - flip) / spot) * 100).toFixed(1)}% away)` `` — matching THIS function's
own established "(X% away)" convention (the same one the Entry trigger fix used earlier this hour),
not `narrateFlip`'s "(X% from spot)" phrasing from the other file — each file keeps its own existing
wording rather than introducing a third variant. Scoped to the live watch/open branches only; the
`bucket === "closed"` branch already states both raw numbers side by side
("Now trades X vs gamma flip Y") and was left unchanged.

### Blast radius

Single branch inside `watchForSection`. Updated the four existing exact-string tests that pin each
direction × spot-side combination (COIN repro: LONG spot 174.98/flip 183.49 → 4.9% away; LONG spot
190/flip 183.49 → 3.4%; SHORT spot 103/flip 99.31 → 3.6%; SHORT spot 95.8/flip 99.31 → 3.7%) — each
value cross-checked arithmetically before being pinned. Two sibling absence-only tests
(`doesNotMatch(/Lose gamma flip/i)`) and the CLOSED-bucket test were unaffected.

### Fix rationale

Same rationale as the three earlier fixes this hour: reuse the exact convention already established
in the same file, add nothing new to compute, touch nothing outside the one branch responsible.

### Tests

- RED: confirmed via `git stash` of only `play-brief-intel.ts` that all four updated tests fail
  against the old code (bare price, no suffix).
- GREEN: restored the fix — all four tests pass with their newly-computed percentages; full
  `play-brief*.test.ts` (1157 tests) and full `npm test` (16709/16712 pass, 3 skipped, 0 fail)
  green; `npx tsc --noEmit` clean.
