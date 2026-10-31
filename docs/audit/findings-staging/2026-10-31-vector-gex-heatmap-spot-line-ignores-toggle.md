> **kind:** FINDING

## Vector GEX heatmap: spot guide line keeps drawing after the member switches the toggle OFF — FIXED

**Status:** Fixed, regression tests added (`src/features/vector/lib/vector-gex-heatmap-primitive.test.ts`, new file — the primitive had zero prior coverage).

### Root cause

`GexHeatmapPrimitive` (`src/features/vector/lib/vector-gex-heatmap-primitive.ts`) implements the
"gex-heatmap" opt-in overlay as an `ISeriesPrimitive`. Its own doc comment states the contract
plainly: *"Data + visibility are pushed via `setData(grid, visible)`; a null/empty grid or
`visible === false` makes `renderer()` return null → nothing is drawn (honest absence, never a
fabricated surface)."*

The pane view's `renderer()` did not actually enforce that:

```ts
renderer(): IPrimitivePaneRenderer | null {
  const rects = this._source.computeRects();
  const spotY = this._source.spotCoordinate();
  if (!rects.length && spotY == null) return null;
  return new GexHeatmapRenderer(rects, spotY, this._source.overlayDim());
}
```

`computeRects()` correctly returns `[]` when `_visible` is false (it checks `this._visible`
explicitly). But `spotCoordinate()` has **no visibility check at all** — it only requires `_series`
and `_spot` to be set:

```ts
spotCoordinate(): number | null {
  if (!this._series || this._spot == null || !Number.isFinite(this._spot)) return null;
  return this._series.priceToCoordinate(this._spot);
}
```

`_spot` is kept fresh by `setSpot()`, which `VectorChart.tsx`'s live-tick handler calls
**unconditionally**, independent of the toggle:

```ts
// VectorChart.tsx ~line 4386, inside the live SSE tick handler:
if (!inReplay) {
  onSpotChange?.(curSpot);
  gexHeatmapPrimitiveRef.current?.setSpot(curSpot);   // <- no toggle check
}
```

So the sequence that triggers the bug is ordinary, not exotic: a member opens the Vector chart with
the GEX heatmap toggle OFF (its default state — "Default OFF — a new visual members opt into"),
RTH ticks arrive (they always do), `setSpot()` keeps `_spot` populated. `renderer()`'s guard
`!rects.length && spotY == null` evaluates to `true && false = false` (rects is empty because the
toggle is off, but `spotY` is non-null because `_spot` was never gated on the toggle) — so the
renderer is NOT suppressed, and `GexHeatmapRenderer.draw()` paints the dashed cyan spot-guide line
across the full pane width with an empty heatmap underneath it. The member sees a persistent stray
line that doesn't go away when they turn the overlay off — the opposite of the "opt-in, honest
absence when off" design the rest of this file documents and implements for every other input.

### Evidence

Behavioral repro (no DOM/canvas needed — same stub-driven technique already used for the sibling
`ISeriesPrimitive` files in this directory):

```js
const prim = new GexHeatmapPrimitive();
prim.attached({ chart, series, requestUpdate: () => {} }); // stub chart/series
prim.setData(null, false); // toggle OFF, no grid
prim.setSpot(105);          // a live tick still arrives, as it always does in production
prim.paneViews()[0].renderer(); // => non-null (BUG): a renderer is created and will paint the spot line
```

`git stash` on the source fix alone reproduces this exactly: 3 of the 4 new tests fail
(`prim.isVisible is not a function` plus the two toggle-OFF assertions getting a non-null
renderer) against unmodified `main`; all 4 pass once the fix lands, and restoring the fix flips
them back to green.

### Blast radius

Single call site — `GexHeatmapPaneView.renderer()` is the only place that decides whether this
primitive draws anything, and the spot-guide line is the only input it forgot to gate. No other
primitive in this directory has the same shape: `GammaRegimePrimitive`, `VolumeProfilePrimitive`,
`ExtendedHoursShadePrimitive` and `EmConePrimitive` all gate their *entire* renderer output on a
single `_enabled`/`_visible` flag checked inside the one method that produces their drawable data
(`geometry()`/`project()`/`computeRects()`), so none of them have a second, independently-gated
input that can leak through. `GexHeatmapPrimitive` is the only one of the five whose drawable
surface is split across two independently-updated pieces of state (`_grid`+`_visible` vs. `_spot`),
which is exactly why the gate needs to live one level up, at the pane view, rather than inside
either individual accessor.

### Fix rationale

Added an explicit `isVisible()` getter on `GexHeatmapPrimitive` (mirroring the `overlayDim()`-style
read-only accessors the class already exposes) and made `GexHeatmapPaneView.renderer()` check it
FIRST, before computing rects or the spot coordinate at all:

```ts
renderer(): IPrimitivePaneRenderer | null {
  if (!this._source.isVisible()) return null;
  const rects = this._source.computeRects();
  const spotY = this._source.spotCoordinate();
  if (!rects.length && spotY == null) return null;
  return new GexHeatmapRenderer(rects, spotY, this._source.overlayDim());
}
```

Considered gating `spotCoordinate()` itself instead (adding a `_visible` check inside it), but that
would silently change `spotCoordinate()`'s own meaning for any future caller that wants the raw
spot projection independent of the heatmap toggle — gating at the pane view keeps `computeRects()`
and `spotCoordinate()` as honest, single-purpose projections and puts the "should this primitive
draw ANYTHING right now" decision in the one place that already owns it (the pane view, which is
also where every sibling primitive makes that exact decision). The pre-existing
`!rects.length && spotY == null` null-check is left in place unchanged (still needed for the
visible-but-genuinely-empty case — no grid fetched yet, no spot tick yet), it's just no longer the
only gate.

### Test plan

New file `src/features/vector/lib/vector-gex-heatmap-primitive.test.ts` (this primitive had zero
test coverage before this PR): drives `paneViews()[0].renderer()` directly against a minimal stub
chart/series (no DOM/canvas), covering: toggle OFF with a live spot already set → null renderer;
toggle flipped OFF *after* a grid was loaded (grid ref untouched) → still null; toggle ON with a
real grid + spot → renders; `isVisible()` mirrors the last `setData` call. `npx tsc --noEmit` clean
and the full `src/features/vector/lib/*.test.ts` suite (1320 tests) passes with the fix.
