> **kind:** FINDING

## Vector bead-rail canvas primitive never flashes a "rebirth" when a wall leaves and re-enters the dominant set — only the trail's very first run can ever flash — FIXED

**Status:** FIXED (`fix/wall-rail-rebirth-birth-flash`)

### Root cause

`WallRailPrimitive.project()` in `src/features/vector/lib/vector-wall-rail-primitive.ts`
splits each strike's bead trail into separate "runs" (`Band`s) wherever two
consecutive buckets are further apart than `GAP_SPLIT_FACTOR` (2.5×) the trail's own
median bucket step — the comment on that constant is explicit about why: *"a real
dead stretch (wall left the dominant set) breaks the band honestly instead of
bridging it."* So a run boundary mid-trail is, by construction, exactly a moment the
wall genuinely disappeared from the dominant set and later came back.

The per-run `flush()` closure decides whether that run gets a "birth" flash (a bright
vertical cap drawn at the run's first bucket, so a member can see when/where a wall
formed):

```ts
const startsInWindow = pts[runStartIdx]!.time > earliest && runStartIdx === 0;
```

`runStartIdx === 0` is ANDed into the condition, so **only the trail's very first run
can ever flash a birth** — no matter how it ends, every later run (i.e. every genuine
"the wall went away and came back") silently gets `birth: null` and renders as an
ordinary continuing run with no formation cue at all.

This directly regresses a feature the OLDER series-marker renderer
(`buildWallBeadMarkers` in `src/features/vector/components/VectorChart.tsx`) already
implements correctly and documents by name — "REBIRTH":

```ts
const reborn = i > 0 && p.time - points[i - 1]!.time > intervalSec * 2;
const trueBirth = i === 0 && earliestBucket != null && p.time > earliestBucket;
if ((trueBirth || reborn) && !modeled) { /* boost this bead like a birth */ }
```

`buildWallBeadMarkers` correctly treats `trueBirth` (the trail's first-ever point,
window-edge-guarded) and `reborn` (ANY later point preceded by a real gap,
unconditionally) as two independent, OR'd cases. The canvas primitive's `flush()`
comment at this exact line even claims `"mirrors buildWallBeadMarkers"`, but the code
only implements the `trueBirth` half — the `reborn` half was dropped, by the stray
`&& runStartIdx === 0`.

This is user-visible on the DEFAULT render path, not an opt-in one: the raw
`b.birth`/`b.death` circle/line markers in `WallRailRenderer.draw()` are only drawn
`if (!this._showEventGlyphs && ...)`, and `"bead-event-glyphs"` is NOT in
`VECTOR_DEFAULT_ENABLED_INDICATORS` (it is an opt-in toggle, confirmed in
`vector-indicators-config.ts`) — so for a member who has not explicitly turned on
Events, this raw birth/death path is what actually renders, and it has silently never
been able to flash a rebirth for any run after the first since the canvas bead rail
shipped.

### Evidence

- Read `vector-wall-rail-primitive.ts`'s `flush()` directly: `startsInWindow` is
  `pts[runStartIdx]!.time > earliest && runStartIdx === 0` — a trail with N runs
  (N−1 real gap-splits) can only ever get `birth` truthy on run index 0, by
  construction of the boolean AND.
- Cross-checked against `VectorChart.tsx`'s `buildWallBeadMarkers`, which this file's
  own comment claims to mirror: that function's `reborn` check fires for ANY `i > 0`
  point preceded by a gap `> intervalSec * 2`, independent of which run/window-edge
  state it is in — proving the canvas primitive's restriction to `runStartIdx === 0`
  is a genuine drift from the documented intent, not an intentional design choice.
- New regression tests in `vector-wall-rail-core.test.ts` (extracted the predicate as
  `wallBeadRunIsBirth` so it is unit-testable without mocking lightweight-charts'
  `IChartApi`/`ISeriesApi`), proven RED before the fix and GREEN after via a scripted
  revert/restore of the function body (`git stash`-equivalent manual patch + rerun):
  - `wallBeadRunIsBirth(0, 1000, 1000)` → `false` (window-edge, first run — unchanged
    behavior).
  - `wallBeadRunIsBirth(0, 1005, 1000)` → `true` (strictly-after-edge first run —
    unchanged behavior).
  - `wallBeadRunIsBirth(3, 2000, 1000)` → `true` — **this is the case that was
    silently `false` before the fix** (any run after the first, i.e. a rebirth).
  - `wallBeadRunIsBirth(1, 500, 1000)` → `true` — rebirth even when the later run's
    own start time is not past `earliest`, confirming the window-edge guard now only
    ever applies to the first run as intended.

### Blast radius

Single call site: `WallRailPrimitive.project()`'s `flush()` in
`vector-wall-rail-primitive.ts` is the only place this predicate is evaluated. It
affects every ticker/lens rendered through the canvas bead rail (the default Vector
chart wall overlay) whenever a strike's wall drops out of the dominant set for longer
than `GAP_SPLIT_FACTOR` × its own median bucket step and later re-enters — a routine
occurrence on any name whose book reshuffles during the session. The
`showEventGlyphs` (Events toggle) path is unaffected by this specific fix (it derives
its own birth/new/gone glyphs independently from `vector-wall-events.ts`'s
`wallStrengthEvents`, which already has no such restriction), but that toggle is
opt-in and off by default, so most members were seeing the regressed (silently
birth-less) rebirth behavior.

### Fix rationale

Extracted the predicate into a new pure, exported helper,
`wallBeadRunIsBirth(runStartIdx, runStartTime, earliest)`, in
`vector-wall-rail-core.ts` (the existing home for this file's other pure/tested bead
math, e.g. `closestRowGapPx`, `clampTuningToSpacing`) rather than patching the
boolean inline in the class method, for two reasons: (1) `WallRailPrimitive` depends
on lightweight-charts' `IChartApi`/`ISeriesApi`, which cannot be exercised by the
plain Node test runner, so the only way to get a RED→GREEN regression test on this
logic at all is to pull it out into a dependency-free function; (2) it documents the
`trueBirth`/`reborn` split explicitly in one place, so the two renderers
(`buildWallBeadMarkers` and the canvas primitive) have a clearly named, intentional
contract to stay in sync against instead of two independent inline booleans that can
silently drift apart again (which is exactly what happened here). Left unchanged:
the `showEventGlyphs` glyph composition path (`vector-wall-event-glyphs.ts`), which
already has its own correct, independently-verified birth/new/gone logic and was not
part of this defect.
