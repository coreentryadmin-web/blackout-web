> **kind:** FINDING

## Vector bead-rail event glyphs (birth/death/handover/wall-shift) silently dropped at nearly every candle interval — FIXED

| | |
|---|---|
| **Area** | Vector desk — dealer-wall bead rail, "Events" toggle |
| **File** | `src/features/vector/lib/vector-wall-rail-primitive.ts` (`WallRailPrimitive.project()`, glyph-projection loop) |
| **Status** | Fixed |

### Root cause

The bead rail records a wall sample roughly every ~5s (`VECTOR_WALL_TRAIL_SEC`), while a chart
candle can span minutes (3m/5m/etc). `lightweight-charts`' `timeToCoordinate(t)` resolves a pixel
**only** when `t` is an exact bar timestamp — for every other time it returns `null`. This exact
defect was already found and fixed once in this file, for the BEAD path: `#2328`
("place beads WITHIN the candle") introduced `vector-bead-x-projection.ts`'s `projectBucketX`,
which interpolates a bucket's x-position between its containing bar and the next one, and wired it
into `addTrail`'s own `x` computation (see the comment at that call site — "35 of every 36 buckets
are therefore not bar times... died in the last hop, at a line that reads like a bounds check").

The event-glyph layer (birth/death/king-handover/wall-shift/flip-cross markers, gated behind the
member-facing "Events" toggle) was added earlier, in `#2241` (2026-08-15, predates `#2328`), and
its glyph-placement code was never revisited when the bead fix landed:

```ts
const x = ts.timeToCoordinate(g.time as Time);   // <- bare call, no sub-bar interpolation
const y = series.priceToCoordinate(g.strike);
if (x == null || y == null) continue;             // <- silently drops the glyph
```

`g.time` comes straight from `composeWallEventGlyphs`, which stamps every glyph at the SAME
sub-bar recorder-bucket granularity as bead points (`wallEventToGlyph` copies `ev.time` from the
raw `VectorWallEvent`, and `trailDerivedGlyphs` copies `first.time`/`last.time`/handover times
straight from `trail.points`, the identical array `addTrail` already projects correctly). So this
one call site has the exact bug `#2328` fixed for beads, reintroduced via a sibling code path that
never got the fix.

### Evidence

- `git log -p --follow -S "ts.timeToCoordinate(g.time as Time)" -- src/features/vector/lib/vector-wall-rail-primitive.ts`
  shows the line was introduced in `0e589e3b0` ("feat(vector): bead-rail event glyphs (D) with
  Events toggle (#2241)", 2026-08-15) — **before** `198d466fe` ("fix(vector): place beads WITHIN
  the candle... (#2328)") added `projectBucketX` and wired it into the bead path a few lines above.
  The glyph loop was left untouched.
- RED→GREEN regression test (`src/features/vector/lib/vector-wall-rail-glyph-x-projection.test.ts`):
  drives `WallRailPrimitive.project()` directly with a chart mock that only resolves `timeToCoordinate`
  for EXACT bar timestamps (matching the real contract — a looser mock that resolved any numeric
  input would hide this bug, which is exactly how it shipped unnoticed). A single `call_wall_new`
  event stamped 90s into a 180s (3m) bar:
  - **Before the fix:** `projected.glyphs.length === 0` — the glyph is silently dropped.
  - **After the fix:** `projected.glyphs.length === 1`, placed at `x = 9` (interpolated halfway
    through the bar's pixel span), matching exactly how a bead at the same bucket time would be
    placed.

### Blast radius

Every glyph kind gated behind `showEventGlyphs` goes through this one loop, so the defect was not
confined to one glyph type:
- `wallEventToGlyph` — call/put wall shift, call/put wall new/gone, flip shift, spot-crossed-flip,
  spot-broke-call/put (every kind in `CHART_GLYPH_EVENT_KINDS`).
- `trailDerivedGlyphs` — birth ticks, death crosses, and king-handover diamonds derived directly
  from the rendered trails.

At any production candle interval coarser than the recorder's own ~5s bucket cadence (i.e. nearly
every timeframe a member would actually view), only a glyph whose bucket time happens to coincide
exactly with a bar open — a rare coincidence, not the norm — would ever render. The member-facing
"Events" toggle therefore painted close to nothing, with no error or console signal: `x == null`
is the same silent "off-screen" path `#2328`'s own docblock already named as the trap ("the
`continue` — commented as an off-screen skip, which is what it looks like — threw them away").

No other call site in this file (or elsewhere in `src/features/vector/lib/`) calls
`ts.timeToCoordinate` directly on a sub-bar bucket time — the bead path (`addTrail`) already uses
`projectBucketX`, and this was the only remaining bare call.

### Fix rationale

Route the glyph x-coordinate through the exact same `projectBucketX` helper the bead path already
uses, with the same `barTimes`/`barSpacingPx`/`intervalSec` inputs already in scope at that point
in `project()`. This is a minimal, single-call-site change — no new helper, no change to
`composeWallEventGlyphs`, `vector-bead-x-projection.ts`, or any other glyph-shape/colour logic.
Deliberately left unchanged: the `x == null || y == null` drop condition itself (still the right
behaviour for a glyph that is genuinely unplaceable, e.g. before the first bar), and every other
channel (colour, severity, label, hit-testing) on `ProjectedGlyph`.
