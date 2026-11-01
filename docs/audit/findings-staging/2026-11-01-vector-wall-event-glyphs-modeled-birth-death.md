> **kind:** FINDING

# Vector wall-event glyphs fabricated "forming"/"dissolved" events from modeled (reconstructed) rail data

| | |
|---|---|
| **Area** | Night Hawk/Vector desk — `/vector` Events overlay (bead rail) |
| **Severity** | P3 — visual/narrative honesty defect, not a data-correctness defect |
| **Status** | Fixed |

## Root cause

`trailDerivedGlyphs` (`src/features/vector/lib/vector-wall-event-glyphs.ts`) derives "wall
forming" (`birth_tick`) and "wall dissolved" (`death_x`) Events-overlay glyphs purely from a
`StrikeTrail`'s first/last points and the `earliestBucket`/`active` flags — with no check at all
of `StrikeTrailPoint.modeled`.

`modeled` marks a point as RECONSTRUCTED (`mergeModeledUnderlay`/`backfillRailPrefix`/
`backfillRailGaps` in `vector-wall-history.ts`) rather than genuinely observed by the live
recorder — every session-load gap before the recorder's first real sample gets a modeled
"ghost" prefix so the chart isn't blank on load. `WallHistorySample.modeled`'s own doc comment
is explicit about why this distinction exists: *"Honesty is the whole point: modeled ≠ observed
must be visible."*

The sibling consumer of the exact same lifecycle data — `buildWallBeadMarkers` in
`VectorChart.tsx`, which draws the bead-marker birth/death BOOST on the candle series — already
encodes this guard, twice, with explicit comments:
- `if ((trueBirth || reborn) && !modeled) { ...birth boost... }` — *"Skip for modeled ghosts
  (they fill the whole session and have no meaningful single birth)."*
- `const isDeath = !trail.active && i === points.length - 1 && !modeled && ...` — *"Skip modeled
  ghosts (no real death)."*

`trailDerivedGlyphs` runs the structurally identical birth/death test (same `StrikeTrail`/
`StrikeTrailPoint` shape, same "first point past the window edge" / "last point of an inactive
trail" logic) for the newer glyph-overlay rendering path (`WallRailPrimitive` → Events toggle)
and never picked up either guard. So a trail whose visible prefix is entirely/partly
reconstructed could paint a confident "Call wall forming at 6,800" or "Put wall dissolved at
6,700" label for a formation/dissolution nobody ever actually observed — exactly the overclaim
the `modeled` flag exists to prevent, on the one surface (hover-labeled Events glyphs) that
states it as a narrated claim rather than just a dimmer bead.

## Evidence

Added a RED→GREEN regression pair to
`src/features/vector/lib/vector-wall-event-glyphs.test.ts`:
- `trailDerivedGlyphs: no birth glyph when the trail's first point is modeled (reconstructed)`
- `trailDerivedGlyphs: no death glyph when the trail's last point is modeled (reconstructed)`

Both failed against the pre-fix code (`git stash` of the source-only change, tests left in
place):
```
not ok 6 - trailDerivedGlyphs: no birth glyph when the trail's first point is modeled (reconstructed)
not ok 7 - trailDerivedGlyphs: no death glyph when the trail's last point is modeled (reconstructed)
# pass 10
# fail 2
```
and pass after the fix (12/12). A third new test confirms the guard doesn't over-suppress: a
death glyph still fires when only an *earlier*, unrelated point on the same trail is modeled but
the trail's own last (boundary) point is real.

## Blast radius

Single call site: `composeWallEventGlyphs` → `trailDerivedGlyphs`, consumed by
`WallRailPrimitive.setData` (`vector-wall-rail-primitive.ts`) for the Events-toggle overlay on
`/vector`. The king-handover (`handover_diamond`) branch of the same function has no sibling
precedent in `VectorChart.tsx` to mirror (that boost concept doesn't exist on the marker layer),
so it is intentionally left untouched — this fix is scoped to the two glyph kinds that have a
documented sibling guard to restore parity with.

## Fix rationale

Add the same `!modeled` check at the same two decision points, copied in spirit (not
mechanically — the glyph code looks at the trail's first/last point directly rather than
iterating with an index) from the already-shipped, already-commented guard in
`buildWallBeadMarkers`. No new behavior is invented — this makes the two consumers of one
lifecycle fact agree, the same "one source of truth, no drift between surfaces" discipline this
file's own comments already apply to wall-integrity tiers (`scoreWallIntegrity`'s `refMaxPct`
comment: *"so the firm/moderate/thin verdict is identical whether it's read on the desk terminal
... or on a bead ring ... one source of truth, no drift between surfaces"*).

Deliberately left unchanged: the king-handover (`kingStrikeByTime`-derived) glyph branch, and the
raw wall-shift/new/gone EVENT-derived glyphs from `wallEventToGlyph` (those come from
`diffVectorWallSample`'s live sample-to-sample diff, not from the trail's own modeled flag, and
have no sibling guard to restore parity with — fixing them would be a new invention, not a
propagation of an existing fix, and is out of scope here).
