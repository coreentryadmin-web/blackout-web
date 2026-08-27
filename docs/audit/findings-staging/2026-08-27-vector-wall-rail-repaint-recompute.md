> **kind:** `FINDING`

## Vector wall-rail primitive recomputed full-history data derivations on every repaint frame — FIXED

| **Status** | FIXED |
|---|---|

**Context.** Member report: "the user actions on vector chart are very slow, lagging ... zoom in,
scroll, drag ... they should be very fast and responsive." Measured live on production first,
before touching any code (per this repo's own "measure, don't guess" standard) — a CDP `Profiler`
session (Chrome DevTools Protocol, via a Playwright `newCDPSession`, NOT the earlier Playwright
action-log tracing attempt which lacks JS call-stack data) was attached during a synthetic
wheel-zoom + click-drag gesture burst against `/vector?ticker=SPX` on prod. Result: **31% of all
CPU samples during the gesture burst landed in a single minified vendor-chunk function**, with
`arc`, `stroke`, `beginPath`, `fill` (canvas 2D primitives), `project`, and `_tick` all appearing as
separate hot functions in the same chunk — consistent with a canvas-drawing chart library doing very
heavy per-frame work.

**Root cause.** `WallRailPaneView.renderer()` (`vector-wall-rail-primitive.ts`) calls
`this._source.project()` — and lightweight-charts invokes `renderer()` on **every single canvas
repaint**, i.e. every wheel tick and every drag mousemove that changes the visible range, since
coordinates must be reprojected against the current scale each frame. `project()` was recomputing,
from scratch, on every one of those calls:
- `maxPctByTime([...callTrails, ...putTrails])` — full scan of every point in every trail
- `kingStrikeByTime(callTrails)` / `kingStrikeByTime(putTrails)` — same, twice more
- an "earliest bucket" scan and a "newest bucket" (`liveTime`) scan — two more full passes

All four of these are **pure functions of the trail DATA** (`this._data`) — none read the viewport,
scale, or anything else that changes between repaint frames. `this._data` itself only changes on the
much lower-frequency poll/refresh cadence (`setData()`, called from `refreshTrails`, not from the
zoom/pan visible-range subscription) — so the SAME `this._data` instance survives many dozens of
repaint frames within a single zoom/drag gesture, and every one of those frames re-ran all four
full-history scans for no reason. With a full session's worth of buckets per trail (the file's own
comments cite "2800+ buckets/session"), that is a real, measurable, repeated cost landing squarely on
the gesture the member described as laggy.

**Fix.** Added a cache (`_derivedCache`) on `WallRailPrimitive`, keyed on `this._data` object
identity: the four derivations (`earliest`, `maxPctAtTime`, `callKingAt`, `putKingAt`, `liveTime`)
are computed once and reused across every repaint frame until `setData()` reassigns `this._data` to
a new object, at which point the cache is invalidated and recomputed exactly once. Cache is also
cleared in `detached()` to avoid holding stale references. The per-frame pixel-projection work
inside `project()` (the `addTrail` loop, which genuinely depends on the current chart scale via
`series.priceToCoordinate`) is untouched — only the data-only preamble is memoized.

**Blast radius.** Only `vector-wall-rail-primitive.ts`. `feedWallRail`/`setData` callers in
`VectorChart.tsx` are unchanged; the cache is entirely internal to the primitive and invisible to
every caller.

**What was deliberately left unchanged.** The per-point canvas draw calls in `WallRailRenderer.draw()`
(halo/ring/core/stroke — up to 4 `arc()`+`fill()` per bead) were NOT touched. That is real,
zoom-level-dependent visual work (more bars visible = more points drawn) rather than a caching bug,
and reducing bead visual fidelity during an active gesture would be a separate, riskier change
requiring its own before/after visual check — not bundled into this fix.

**Verification.** `tsc --noEmit` clean, full suite clean (10992 pass / 0 fail / 2 pre-existing
skips), `npm run build` clean. No existing test harness instantiates `WallRailPrimitive` directly
(it requires a real `IChartApi`/`ISeriesApi`, which the repo's other primitive files also have no
test coverage for) — verification is the live CDP profile itself: a follow-up profile run against
production post-deploy will confirm the before/after change in self-time share for the hot chunk
identified above, the same methodology used to find the bug in the first place.
