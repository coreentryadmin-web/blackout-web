> **kind:** `FINDING`

## Vector Compare mode audit — missing zoom controls, redundant sync-zoom remount, mislabeled preset — FIXED

| **Status** | FIXED |
|---|---|

Compare mode (the 4-up chart grid) was deliberately left untouched during today's round of
standalone-chart fixes except for the candle-floor bypass fix, so a dedicated audit was run to find
what had drifted. Three real, verified findings, all fixed here.

### FIXED — Compare panes had NO zoom in/out/reset controls at all
**File:** `src/features/vector/components/VectorToolbar.tsx`

`VectorChart.tsx` builds `handleZoomIn`/`handleZoomOut`/`handleZoomReset` and passes them to the
toolbar unconditionally, and `VectorToolbar` even precomputes a `zoomControls` element from them —
but only the non-compare branch ever rendered it. The `comparePane` early-return branch (taken for
every Compare pane) rendered the indicator menu, bead-rail toggle, NODES toggle, draw tools, and
replay controls, but never referenced `zoomControls`. Compare's own linked command bar
(`VectorCompareCommandBar.tsx`) only wires Session/Structure/Live viewport *presets*, disabled
entirely in "Per-pane" (unlinked) mode — so a member in per-pane mode had no way to zoom a single
pane at all, and even in linked mode never got the discrete step-zoom feature that shipped
standalone today.

**Fix:** render a `VectorZoomControls` instance inside the `comparePane` branch, with
`exposeTestIds={false}` (not the shared `zoomControls` variable, which defaults `true`) since up to
4 panes render this row simultaneously — the same convention the NODES toggle right above it
already follows for exactly this reason.

### FIXED — every "Sync zoom" click forced a redundant full remount of all 4 panes
**Files:** `VectorCompareDesk.tsx`, `VectorComparePane.tsx`

`applySyncZoomPreset` called `bumpSync()`, which increments `syncEpoch` — folded into
`VectorComparePane`'s React `key` whenever panes are linked. A `key` change forces React to fully
destroy and rebuild the entire pane subtree: the lightweight-charts instance, the
`WallRailPrimitive`, and the SSE connection, for all 4 panes at once. But `VectorChart.tsx` already
has a reactive effect built specifically to apply a synced zoom preset **without** remounting
(`compareSync?.zoomPreset` delivered via a tick counter, applied through the same cheap
`setVisibleLogicalRange`-class path used by ordinary zoom). The remount was pure waste layered on
top of a path that already worked — and it directly worked against today's wall-rail perf fix
(#2939), discarding the very `WallRailPrimitive._derivedCache` that fix keeps warm across repaints,
on every single sync-zoom click.

**Fix:** split the flash-only visual feedback (`setSyncFlash`) out of `bumpSync()` into its own
`flashSync()` helper, and have `applySyncZoomPreset` call `flashSync()` instead of `bumpSync()` — the
member still sees the "synced" pulse, with none of the remount cost. Every other `bumpSync()` call
site (adding/removing a ticker, applying a whole-grid preset, changing timeframe/lens/DTE) is
untouched — those genuinely need the remount, since `VectorChart.tsx` only consumes those as
`useState` initializers.

### FIXED — the "Mag 7" compare preset only ever carried 4 tickers
**File:** `src/features/vector/lib/vector-compare.ts`

`{ id: "mag7", label: "Mag 7", tickers: ["NVDA", "AAPL", "MSFT", "AMZN"] }` — capped at 4 by
`VECTOR_COMPARE_MAX_PANES`, 3 short of the real Magnificent Seven, while the label claimed 7.

**Fix:** relabeled to "Big Tech" — a claim the preset can actually keep. The `id` field ("mag7") was
deliberately left unchanged: `src/lib/x-intel/capture-catalog.ts` references it as a stable
`preset=mag7` param for a capture recipe, and renaming the id would have silently broken that
recipe. Only the member-facing label changed.

**Verification:** new tests in `vector-chart-viewport.test.ts` (zoom controls present in the compare
branch; sync-zoom preset no longer calls the remount path) and `vector-compare.test.ts` (no preset's
label claims more tickers than it carries). `tsc --noEmit` clean, full suite clean (11004 pass / 0
fail / 2 pre-existing skips), `npm run build` clean.
