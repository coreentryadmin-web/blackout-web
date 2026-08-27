> **kind:** `FINDING`

## Compare-mode "Sync zoom" broadcast can corrupt a replaying pane's viewport — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Component** | `VectorChart.tsx` (Compare-mode `compareSync?.zoomPreset` effect) |
| **Severity** | P2 — visual/functional corruption of one pane's replay, no data-integrity impact |

### Root cause

The effect that applies a broadcast intraday-zoom preset in Compare mode had no replay guard:

```ts
useEffect(() => {
  const payload = compareSync?.zoomPreset;
  if (!chartReady || !payload) return;
  handleIntradayZoomRef.current(payload.preset);
}, [chartReady, compareSync?.zoomPreset?.tick]);
```

This is a **different call site of the same underlying bug** just fixed in `handleZoomReset`
(#2969): `handleIntradayZoom` recomputes its viewport from
`displayBarsFromMinute(minuteBarsRef.current, timeframeRef.current)` with no `cursorTime` — the
full, still-growing LIVE minute-bar buffer, not the replay-cursor-sliced one. Every other caller of
this class of operation already guards against replay:

- The per-pane toolbar zoom-preset selector (`VectorIntradayZoomControls`) is
  `disabled={replayMode}`-gated at its `VectorToolbar` call site.
- The keyboard shortcut for the same operation already has `if (replayMode) return;`.

This `compareSync`-driven effect — the cross-pane broadcast path — was the one caller with no
guard at all.

### Concrete reproduction (confirmed by tracing the actual code, not assumed)

1. Unlink Compare panes (`linked=false`). Each pane's own replay control becomes visible — it's
   only hidden via `hideReplayControls={linked}` at the `VectorCompareDesk` call site.
2. Manually enter replay on ONE pane (`toggleReplay` → `enterReplay`). This sets that pane's own
   `replayModeRef.current = true`, with `linkedReplayControlledRef.current` left `false` since it
   was entered manually, not via the linked-replay path.
3. Re-link the panes (`linked=true`). The relink path only calls `exitReplay()` for panes it itself
   put into replay (gated on `linkedReplayControlledRef`), so the manually-replaying pane's replay
   state is left untouched.
4. Click the shared "Sync zoom" command-bar control. It's gated only on `linked` (`disabled={!linked}`
   in `VectorCompareCommandBar.tsx`), with no check on any pane's individual replay state, and bumps
   `compareSync.zoomPreset.tick` for every pane.
5. The still-replaying pane's `compareSync?.zoomPreset` effect fires unconditionally and calls
   `handleIntradayZoom`, which recomputes the viewport off the full live buffer — corrupting that
   pane's replay frame exactly like the pre-fix `handleZoomReset` did, just triggered by a sibling
   pane's click instead of the member's own.

### Fix

Added `if (replayModeRef.current) return;` immediately after the existing early-returns in the
effect, matching the keyboard shortcut's own guard for the identical operation. A member scrubbed
into replay on one pane no longer has that pane's viewport clobbered by a zoom-sync broadcast from
a sibling pane.

### Blast radius

Single effect, single file. Confirmed via a background investigation (dispatched after the #2969
audit round flagged this as low-confidence/unreproduced) that traced `compareSync`'s origin
(`vector-compare-sync.ts`, `VectorCompareDesk.tsx`), the linked-replay/per-pane-replay relationship,
and the exact unlink→manual-replay→relink→broadcast trigger sequence — this is a real, reachable
production bug, not merely theoretical.

### Test

`VectorChart-compare-sync-zoom-replay-guard.test.ts` — source-invariant guard (no React render
harness in this repo) asserting the effect returns early when `replayModeRef.current` is true.
