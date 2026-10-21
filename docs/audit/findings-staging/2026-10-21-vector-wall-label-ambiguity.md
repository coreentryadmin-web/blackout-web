> **kind:** FINDING

## Vector play engine: secondary gamma wall rendered under the identical "call wall"/"put wall" label as the primary — FIXED

**Root cause.** `collectLevels()` in `src/features/vector/lib/vector-play-engine.ts` pushed BOTH
`gexWalls.callWalls[0]` (the strongest call wall by gamma-share) and `gexWalls.callWalls[1]` (the
second-strongest) under the identical `"call wall"` label (same for `putWalls`). `gex-wall-levels.ts`
sorts `callWalls`/`putWalls` by `.pct` (gamma-share STRENGTH) descending — NOT by distance to spot
(confirmed via `grep -n "callWalls.sort\|putWalls.sort" src/lib/providers/gex-wall-levels.ts`:
`callWalls.sort((a, b) => b.pct - a.pct)`) — so the second-strongest wall can legitimately sit
CLOSER to spot than the strongest one. `pickTargets()` (same file) then groups/selects candidates by
distance to spot, so it could silently select and bare-label the weaker, secondary wall as a target
with no way for a reader of the rendered target list to tell it apart from an independent reading of
the primary wall at a different price.

Confirmed live via direct source inspection + a probe script: with `callWalls: [{strike:7600,pct:8},
{strike:7650,pct:4}]` and a breakout scenario whose entry trigger is the 7,600 wall (filtering it out
of the target list via the `beyond` parameter), the SECOND wall (7,650, the weaker one) surfaced as a
target — before this fix, bare-labeled `"call wall 7,650"`, indistinguishable from a reading of the
primary (7,600) wall at a different price.

**Evidence.** RED→GREEN proof via `git stash` on `vector-play-engine.ts` alone (never the test
file): stashed, the extended "a breakout targets levels BEYOND the trigger" test failed (`not ok
42`), 45/46 pass; restored, 46/46 pass. `tsc --noEmit` clean. Checked blast radius: every existing
test in `vector-play-engine.test.ts` that touches a 2-element `callWalls`/`putWalls` array asserts
only on the PRICE substring (via regex extracting the trailing number, or `doesNotMatch`/`match` on
a price), never on the exact label text — none needed updating. `play-brief-intel.ts`'s
`Targets:` line (line 2931) renders `p.targets` verbatim with no label matching, so the rename is
purely additive disclosure there too — no other consumer in the repo matches on the literal
`"call wall"`/`"put wall"` strings from this array.

**Fix rationale.** Relabeled the second push in `collectLevels()` to `"2nd call wall"`/`"2nd put
wall"`, leaving the (intentional) strength-based sort order in `gex-wall-levels.ts` untouched, and
leaving `play-brief-narrative.ts`'s `narrateWall`/`collectFocalLevels` untouched (already correct —
they read only index `[0]`, the primary wall, and were never part of this bug). Minimal, label-only
change; no other logic in `pickTargets()` or `buildVectorPlay()` was touched.

| **Status** | FIXED |
|---|---|

**Fix**: PR (branch `fix/vector-wall-label-ambiguity`).
