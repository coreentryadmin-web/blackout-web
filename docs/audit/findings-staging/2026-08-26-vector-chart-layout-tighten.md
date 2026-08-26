# Vector standalone chart: view-toggle + regime banner ate chart height, candles loaded off-center — FIXED

> **kind:** FINDING

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Component** | `src/features/vector/components/VectorPageShell.tsx`, `VectorChart.tsx`, `src/app/globals.css` |
| **Reported** | 2026-08-26, live member screenshots + annotation (`/vector?ticker=SPX`) |

## Reports (member's own words + annotated screenshots)

1. Remove the "SHORT GAMMA …" narrative popup above the chart.
2. Remove the INTRADAY/4H/1D/1W selector row entirely — default (and only) view is Intraday.
3. Move the chart up to reclaim the vertical space freed by (1) and (2).
4. Fit the chart so the page doesn't need to be scrolled to see it, matching the reference
   layout on the SPX Slayer embed.
5. Candles should load centered by default — currently they load "somewhere" (right-anchored).

## Root cause / fix per item

1. **Regime banner** (`VectorRegimeBanner`): the standalone page passed
   `regimeSlot={<VectorRegimeBanner regime={regime} />}` into `VectorChart`, which renders it in a
   `mb-2` block directly above the canvas. Changed to `regimeSlot={null}` for the standalone page
   only — `regime` state itself is untouched (still feeds Compare sync and contract-picks
   reasoning). The chart-only SPX Slayer embed (`embedRegimeSlot`) is a different product surface
   and is deliberately left alone.
2. **View toggle**: `VectorPageShell` owned a `chartView` state (`"intraday" | "4H" | "1D" | "1W"`)
   plus a `VectorChartViewSelect` toggle row (`chartColumnHead`) and a ternary that swapped the
   intraday `VectorChart` for a `VectorDailyChart` on any non-intraday value. All of it removed
   from the standalone page — the chart column now always renders `chartBlock` (the intraday
   chart). `VectorDailyChart`/`VectorChartViewSelect` themselves are left in place (no other
   surface imports either), just disconnected from this page.
3. **Move the chart up**: automatic once (1) and (2) are gone — the DOM elements that used to
   occupy that vertical space no longer exist, so the grid starts higher on the page without any
   layout change needed for this item specifically.
4. **Fit without scrolling**: `.vector-page-shell .vector-chart-terminal-grid`'s
   `min-height: calc(100dvh - 10.5rem)` was sized for a page stacking toolbar + view-toggle +
   regime banner + the grid. With the view-toggle and banner rows gone, reduced the subtrahend to
   `7rem` (site nav + the single toolbar row) so the grid — and the chart inside it — claims the
   freed vertical space instead of leaving it as unused whitespace above a still-short chart.
5. **Centered candle load**: `VectorChart`'s first-paint framing branched on
   `defaultChartViewport`: `"live"` (used by the SPX Slayer embed, `vector-ticker.ts`) called
   `applyCenteredLiveViewport` (latest ~48 bars, newest bar near the middle — the exact look the
   member pointed to as the reference); `"session"` (the standalone page's default) called
   `applySessionOverviewViewport`, which pins the newest bar 2 slots from the right edge with
   nothing padding the left — candles read as dropped against one side, not centered. Changed the
   `sessionFramedOnLoad` branch to also call `applyCenteredLiveViewport` for the FIRST paint only.
   Every *ongoing* session-overview behavior (autoscale gating via `sessionOverviewFrame`, re-seed
   framing on a new session, live-follow opt-in) still keys off
   `defaultChartViewportRef`/`intradayZoomPresetRef` being `"session"`, completely unchanged —
   this only changes what the member sees the instant the chart mounts.

## Blast radius

- `VectorPageShell.tsx`: also dropped the now-dead `hoverPrice`/`setHoverPrice` state (its only
  producer was the removed `VectorDailyChart` crosshair) and the optional `hoverPrice` prop on
  `VectorOdteMatrixRail` (defaults to `null` there already).
- `applySessionOverviewViewport` remains in active use at every other call site (re-seed handling,
  session-boundary transitions) — only the very first mount's framing changed.

## Tests

`vector-chart-viewport.test.ts`: updated the two tests that asserted the now-removed selector/
daily-chart wiring and the old first-load `applySessionOverviewViewport` call; added tests for the
new regime-banner-null wiring and the centered first-load framing. `tsc --noEmit` clean; full suite
10972 pass / 0 fail / 2 pre-existing skips; `npm run build` clean.
