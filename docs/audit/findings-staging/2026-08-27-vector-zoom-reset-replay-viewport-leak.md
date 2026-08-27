> **kind:** `FINDING`

## Vector zoom-reset button corrupts the replay viewport — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Component** | `VectorChart.tsx` / `VectorZoomControls.tsx` |
| **Severity** | P2 — visual/functional corruption of replay, no data-integrity impact |

### Root cause

`handleZoomReset` (the ⟲ button wired through `VectorZoomControls` at all three `VectorToolbar`
call sites — desktop row, compact/mobile row, compare-pane row) computed its display bars with:

```ts
const display = displayBarsFromMinute(minuteBarsRef.current, timeframeRef.current);
```

`displayBarsFromMinute(minuteBars, intervalMinutes, cursorTime?)` only slices `minuteBars` to a
point in time when a `cursorTime` is supplied — omitted, it aggregates the **entire** live minute
buffer. `minuteBarsRef.current` keeps growing with live bars even while a member is scrubbed into
replay (that accumulation is exactly why `applyFrame` exists: it re-slices the buffer to the cursor
on every frame). `applyFrame` itself always passes a cursor time here (`VectorChart.tsx:3125`); the
established pattern for computing that cursor time from outside `applyFrame` already exists
elsewhere in the same file (`VectorChart.tsx:2477`, inside the wall-rail feed):

```ts
const eventCursorTime =
  replayModeRef.current ? (timelineRef.current[cursorIndexRef.current] ?? undefined) : undefined;
```

`handleZoomReset` never adopted it. So clicking Reset zoom mid-replay recomputed `display.length`
off the full, still-growing live bar count and re-centered the viewport
(`applyCenteredLiveViewport(chart, display.length)`) as if the member were live — corrupting the
scrubbed frame's viewport (wrong bar count, wrong centering) while every other overlay stayed
correctly frozen at the cursor.

### Why it wasn't caught earlier

The sibling preset selector for the SAME class of operation, `VectorIntradayZoomControls`
(session/structure/etc.), already has a `disabled` prop wired to `replayMode` at its call site —
so that control is unreachable during replay and never hit this bug. `VectorZoomControls` (the
separate +/−/reset trio) has **no** `disabled` prop at all, at any of its three `VectorToolbar`
render sites. The two plain zoom in/out buttons are harmless during replay — `stepZoom` only
rescales the chart's *currently rendered* logical range, it never recomputes bars from
`minuteBarsRef`, so it never leaks live data regardless of replay state. Only the reset button
recomputes from the raw buffer, and it's the one member of the trio without any replay guard —
an easy asymmetry to miss since the other two buttons in the same component are fine.

### Fix

Hardened `handleZoomReset` to compute the same `replayModeRef.current ? (timelineRef.current[...]
?? undefined) : undefined` cursor-time value used elsewhere in the file, and pass it as
`displayBarsFromMinute`'s third argument — mirroring `applyFrame`'s own cursor-scoping exactly.
Deliberately did **not** add a `disabled` prop to `VectorZoomControls` — unlike the intraday-zoom
presets, the reset button doesn't need to be unreachable during replay; with the cursor-time fix it
now does the CORRECT thing during replay (re-center on the cursor-sliced frame) rather than needing
to be disabled to avoid a wrong one. That is a better outcome for a scrubbing member than losing
the reset control entirely.

### Blast radius

Single call site (`handleZoomReset`), single file. `handleIntradayZoom`'s own "session"/"structure"
presets have the identical missing-`cursorTime` pattern in the same function, but they're routed
through `VectorIntradayZoomControls`, which is already `disabled={replayMode}`-gated — unreachable
during replay, so not a live bug and left alone. A related, lower-confidence finding from the same
audit round (`compareSync?.zoomPreset` effect, `VectorChart.tsx:2044-2048`, no `replayMode` check)
needs Compare-mode's per-pane replay-state ownership investigated before deciding whether it's a
reachable bug — deferred to a follow-up, not bundled into this fix.

### Test

`VectorChart-zoom-reset-replay-guard.test.ts` — source-invariant guard (no React render harness in
this repo) asserting `handleZoomReset` computes the cursor-time value and passes it as
`displayBarsFromMinute`'s third argument.
