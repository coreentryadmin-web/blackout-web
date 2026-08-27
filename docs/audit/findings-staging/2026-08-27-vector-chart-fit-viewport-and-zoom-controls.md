# Vector standalone desk still required a full-page scroll to reach the chart/walls — FIXED

> **kind:** FINDING

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Component** | `src/app/globals.css`, `VectorChart.tsx`, `VectorToolbar.tsx`, new `VectorZoomControls.tsx` |
| **Reported** | 2026-08-27, live member screenshot (`/vector?ticker=SPX`, wide desktop) with the whole viewport circled and annotated "have to scroll to the end of the page to view the volume bars and other walls" |

## Root cause

`.vector-page-shell .vector-chart-terminal-grid` (the 3/4-column grid holding the GEX ladder,
chart, Helix terminal, and action rail) only ever set `min-height` — a floor, never a ceiling.
Every one of those four rails is already built correctly with an internal scroll region
(`.vector-odte-matrix-scroll`, `.vector-helix-scroll`, `.vector-action-rail` at 1600px+ — each
`flex: 1 1 auto; min-height: 0; overflow-y: auto`), but none of them ever activated. The reason is
the classic CSS percentage-height trap: every one of those regions sits under a `height: 100%`
ancestor, and a percentage height only resolves against a **definite** parent size. Because the
grid's own height was only a `min-height`, CSS Grid's implicit row sizing fell back to "auto" (grow
to fit content) whenever a rail's content was taller than the viewport allowance — so `height:100%`
down the whole chain resolved to "auto" too, `overflow-y:auto` never had a bounded box to clip
against, and a 20-row GEX ladder or a long Helix print/premium list pushed the **entire grid** (and
therefore the whole page) taller instead of scrolling inside its own column. The chart itself was
never the problem; it was just dragged down along with everything around it.

## Evidence

Member's own screenshot at `/vector?ticker=SPX` (wide desktop, the 1600px+ four-column layout)
shows the visible viewport (red box) covering only the ladder header and the top ~15 GEX rows, with
the candles, volume profile, and lower walls all below the fold — confirming the grid's rendered
height exceeded the viewport by a large margin, not by a few pixels.

## Fix

Added a **definite** `height` + `max-height: calc(100dvh - 7rem)` to `.vector-chart-terminal-grid`
— but ONLY inside the `@media (min-width: 1600px)` block, where all four rails genuinely sit
side-by-side in one row. Below that breakpoint (1280-1599px) the action rail is still a separate
full-width row *underneath* the 3-column section (`grid-column: 1 / -1`), so capping the whole
grid's height there would squash that row's own space along with everything else — a different,
unreported layout, deliberately left alone. Below 1280px the layout is a single stacked column
(mobile) where scrolling the whole page is the correct, expected UX and is unaffected.

With a definite height in place, every rail's existing `overflow-y: auto` region now finally
clips/scrolls internally as designed — the chart column (which has no scrollable list, just a
resizable canvas) simply gets its correctly-sized share of the fixed-height row and never needs
the page to grow to be reachable.

## Zoom/pan controls (same report: "add better user controls for zoom in, zoom out, drag, move")

Mouse-wheel zoom and click-drag pan already existed on the chart but had no on-screen control at
all. Added explicit **Zoom out / Reset / Zoom in** buttons to the standalone toolbar:
- `zoomedLogicalRange(range, factor, minSpan)` (`vector-chart-viewport.ts`) — pure helper that
  scales the chart's current visible logical range around its own center, floored at a minimum
  span so zoom-in can't collapse the range to nothing. Independently unit-tested.
- `VectorChart`'s `stepZoom`/`handleZoomIn`/`handleZoomOut` route button clicks through the exact
  same viewport-lock bookkeeping (`chartUserPannedRef`, `wheelZoomCooldownRef`,
  `queueDeferredRepaintRef`) a real wheel tick uses, so a button click is indistinguishable from a
  gesture to every other part of the chart that gates on "the member just zoomed" (autoscale
  widening, auto-coarsen, live-follow).
- `handleZoomReset` re-centers on the newest bar with the same `applyCenteredLiveViewport` framing
  the chart already opens with, and clears the pan/cooldown flags so autoscale widening resumes.
- New `VectorZoomControls.tsx` renders the three buttons; wired into `VectorToolbar`'s desktop and
  mobile rows via optional `onZoomIn`/`onZoomOut`/`onZoomReset` props (an embed that doesn't pass
  them simply omits the control rather than rendering a dead one).

## Blast radius

None — the grid height change is scoped to a single breakpoint's rule for one component; the zoom
buttons are new, additive, optional props with no default wiring into any other consumer
(Compare panes keep their existing preset-based `VectorIntradayZoomControls`, untouched).

## Tests

`vector-chart-viewport.test.ts` (lib): 4 new tests for `zoomedLogicalRange` (scale in, scale out,
minSpan floor, degenerate-input guards). `vector-chart-viewport.test.ts` (components, source-text):
2 new tests asserting the 1600px+ grid rule carries a definite height while the base/mobile rule
stays a min, and that the zoom handlers/buttons are wired end-to-end. `tsc --noEmit` clean; full
suite 10990 pass / 0 fail / 2 pre-existing skips; `npm run build` clean.
