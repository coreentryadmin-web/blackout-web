> **kind:** FINDING

## Vector "Events" overlay (`trailDerivedGlyphs`) never emits a rebirth glyph — only the bead-rail primitive flashes it, so the opt-in label layer silently fell out of sync with the layer it annotates — FIXED

**Status:** FIXED (`fix/wall-event-glyphs-rebirth`)

### Root cause

`vector-wall-event-glyphs.ts`'s `trailDerivedGlyphs` derives `birth_tick`/`death_x` glyphs for
the opt-in "Events" overlay from each `StrikeTrail`'s `points` array. `trailsByStrike`
(`vector-wall-history.ts`) emits one `StrikeTrail` **per strike**, not per contiguous run: a
strike that is dominant, drops out of the dominant set for a stretch, then re-enters later
produces a single trail whose `points` array simply has a time GAP in it (no point recorded
during the dead stretch) — the same shape `WallRailPrimitive` and `buildWallBeadMarkers`
(VectorChart.tsx) already treat as a REBIRTH and flash a birth-equivalent cue for.

`trailDerivedGlyphs`'s birth detection only ever examined `pts[0]` (the trail's very first
point):

```ts
const first = pts[0]!;
if (first.time > earliestBucket && !first.modeled) { /* emit birth_tick */ }
```

There was no loop over the rest of `points` checking for an internal gap at all, so a rebirth
anywhere after index 0 produced **zero** glyph — not a suppressed one, simply nothing. This is
the exact bug class PR #7376 (same round, same file family) found and fixed in the sibling
canvas bead-rail primitive (`WallRailPrimitive.project()`'s `flush()`, gated on
`runStartIdx === 0`), and that PR's own write-up explicitly (and incorrectly) asserted the
Events-toggle glyph path was "unaffected... has no such restriction" — true that it lacked that
*specific* restrictive guard, but it independently lacked the reborn-detection logic entirely,
which is a different bug with the same user-visible symptom.

Concretely: once #7376 landed, the default bead render now correctly flashes a birth boost the
moment a wall re-enters the dominant set mid-session (routine on any name whose book reshuffles
during a session, per #7376's own blast-radius note). A member who turns on the "Events" toggle
on top of that render gets a glyph legend/hover label meant to narrate exactly these moments —
but for every rebirth, the overlay shows nothing: the bead flashes, no "Call wall forming at X"
event appears beside it.

### Evidence

- Read `vector-wall-rail-primitive.ts`'s `project()`/`flush()` (post-#7376) and
  `VectorChart.tsx`'s `buildWallBeadMarkers`: both treat "any later point preceded by a gap
  bigger than `GAP_SPLIT_FACTOR`(2.5)× the trail's own median bucket step" as a genuine
  re-formation, unconditionally (not window-edge-guarded — only the very first point needs that
  guard).
- `trailDerivedGlyphs` had no equivalent loop at all — confirmed by reading the full function
  before this fix (only `pts[0]` and `pts[pts.length-1]` were ever inspected).
- New regression tests in `vector-wall-event-glyphs.test.ts`, proven RED before the fix and GREEN
  after (`git stash`/`git stash pop` on the source file alone, test file unchanged):
  - `trailDerivedGlyphs: rebirth after a real gap gets its own birth glyph` — a trail at
    `[100, 115, 130, 400, 415]` (15s cadence, gap to 400 is 270s ≫ 15×2.5) now emits TWO
    `birth_tick` glyphs (true birth at 100, rebirth at 400); pre-fix it emitted only one.
  - `trailDerivedGlyphs: ordinary cadence jitter does not fabricate a rebirth glyph` — a slightly
    uneven but genuine cadence (`[100, 115, 132, 145]`) stays under the gap threshold and emits
    only the one true birth, proving the fix doesn't over-fire on recorder jitter.
  - `trailDerivedGlyphs: no rebirth glyph when the resuming point is modeled` — a reconstructed
    (`modeled: true`) resumption point is still excluded, mirroring the existing honesty guard on
    the true-birth and death cases in the same function.
- Full RED/GREEN run: `npx tsx --experimental-test-module-mocks --test
  src/features/vector/lib/vector-wall-event-glyphs.test.ts` — 14/15 pass with the source reverted
  (only the new rebirth test fails, exactly as expected), 15/15 pass with the fix applied.

### Blast radius

Single function, single call site: `trailDerivedGlyphs` is called only from
`composeWallEventGlyphs` (same file), which is called only from `WallRailPrimitive.project()`
when the opt-in `showEventGlyphs` ("Events") toggle is on. Every ticker/lens is affected
identically whenever a wall drops out of the dominant set and later re-enters — the same routine
condition #7376 described for the sibling bead render. `wallEventToGlyph` (the other glyph
source, derived from genuine `VectorWallEvent` records rather than trail-derived reconstruction)
is untouched and unaffected — it already carries its own `call_wall_new`/`put_wall_new` kinds
independently and was never part of this gap.

### Fix rationale

Mirror the canonical `trueBirth || reborn` split from `buildWallBeadMarkers`/`wallBeadRunIsBirth`
inside `trailDerivedGlyphs` itself, using the SAME gap-detection formula (median bucket step ×
2.5) the bead-rail primitive already uses — computed locally from each trail's own `points`
rather than threaded in from a caller, so the fix is self-contained and doesn't require touching
`vector-wall-rail-primitive.ts` (mid-CI on a different fix, #7376, this same round) or its call
site. The constant is duplicated rather than imported, with a comment to keep the two in sync,
because `vector-wall-rail-primitive.ts` pulls in lightweight-charts' primitive types and is not
meant to be imported by this pure/testable sibling module. Deliberately left unchanged: the
existing death-glyph logic (only the trail's final point, when inactive) — that already matches
`buildWallBeadMarkers`'s own `isDeath` rule, which intentionally does NOT flag an internal
mid-session drop-out as a death, only the trail's true end.
