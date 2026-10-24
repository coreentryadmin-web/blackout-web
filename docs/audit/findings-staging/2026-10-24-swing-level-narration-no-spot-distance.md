> **kind:** FINDING

## Night Hawk Swings: half the "Trade manager read" level narrations never stated their distance from spot — FIXED

**Status:** FIXED

### Root cause

`play-brief-narrative.ts` narrates each structural level (`FocalLevel`, carrying an already-computed
signed `distancePct`) through one of six small functions called from `tradeManagerNarrativeSection`'s
focal-level loop: `narrateWall`, `narrateMaxPain`, `narrateMagnet`, `narrateKing`, `narrateDarkPool`,
`narrateFlip`. Three of the six (`narrateWall`, `narrateMaxPain`, `narrateMagnet`) already state
`"(X% from spot)"` next to the cited price — the other three (`narrateKing`, `narrateDarkPool`,
`narrateFlip`) never did, even though they read `level.distancePct`/`level.price` off the exact same
`FocalLevel` shape and the value was sitting right there.

Found this cycle by re-checking sibling level-rendering call sites for the same omission class after
two earlier fixes this session (#6641 "Entry trigger", #6648 "Break watch") each found an instance of
it. This is the third and, on inspection, most systemic instance — not one line but half of a whole
family of sibling functions sharing one convention inconsistently.

### Evidence

Direct reading of all six narration functions confirmed the split: `narrateWall` → `` `(${fmtPct(level.distancePct)} from spot)` ``;
`narrateMaxPain` → `` `(${fmtPct(level.distancePct)} ${pull} spot)` ``; `narrateMagnet` → `` `(${fmtPct(level.distancePct)} from spot)` ``;
`narrateKing`/`narrateDarkPool`/`narrateFlip` → none. Confirmed all three missing functions are live,
reachable call sites (`tradeManagerNarrativeSection`'s focal loop, lines ~1558–1580; `narrateDarkPool`
also called directly at line ~1712), not dead code.

### Fix

Added `` `(${fmtPct(level.distancePct)} from spot)` `` to all three missing functions, matching the
exact phrasing `narrateWall`/`narrateMagnet` already use (the plurality convention of the three that
already had it). No new computation — `level.distancePct` was already being read by each function for
its other branches (`narrateDarkPool`'s side/hold logic, `narrateFlip`'s lose/reclaim logic); this just
stops discarding it before the sentence is built.

### Blast radius

Three functions, one file, all called from the same narration loop plus `narrateDarkPool`'s second
call site (`watchForSection`'s own separate dark-pool mention — confirmed unaffected, it calls a
different code path). No test needed updating for exact-string matches: checked every existing
assertion touching these three functions' output and all used loose regexes (`.*`/`i`-flag matches)
that tolerate the inserted text; the three `Gamma flip narration` sign-correctness tests specifically
assert only the `longBreak` clause (`Lose **X** → ...`), which is untouched by this fix.

### Fix rationale

Reused the exact phrasing already shipped twice over (`narrateWall`, `narrateMagnet`) rather than
inventing a third convention — this file already has two slightly different spellings
(`"from spot"` vs `"{pull} spot"`); matched the more common one rather than adding a fourth variant.

### Tests

- RED: confirmed via `git stash` of only `play-brief-narrative.ts` that three new tests fail against
  the old code (bare level, no distance) — cross-checked the expected percentages against each
  fixture's own "Break watch" line in the same output (e.g. dark pool test's own Break-watch bullet
  independently showed "0.5% away", confirming the -0.5% expectation).
- GREEN: restored the fix — all three new tests pass; full `play-brief*.test.ts` (1157 tests) and
  full `npm test` (16709/16712 pass, 3 skipped, 0 fail) green; `npx tsc --noEmit` clean.
- Added `tradeManagerNarrativeSection: dark pool narration states its distance from spot`, `...: GEX
  king narration states its distance from spot`, `...: gamma flip narration states its distance from
  spot` (all 2026-10-24).
