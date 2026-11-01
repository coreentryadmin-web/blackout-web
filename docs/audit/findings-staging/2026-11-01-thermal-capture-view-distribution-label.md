> **kind:** FINDING

# Thermal GexHeatmap PNG capture mislabels the Greeks Distribution tab as "matrix"

| Field | Value |
|---|---|
| **Area** | Thermal / GexHeatmap (`/heatmap`) — PNG snapshot export |
| **Severity** | P3 (cosmetic/metadata defect — no data corruption, no broken rendering) |
| **Status** | Fixed |

## Root cause

`GexHeatmap.tsx`'s `captureView` derivation (used only to build the downloaded PNG's filename
via `thermalCaptureFilename()`) was a 3-way ternary over `pairView`:

```ts
const captureView: ThermalCaptureView = compare
  ? "grid"
  : pairView === "pair-b"
    ? "profile"
    : pairView === "pair-c"
      ? "depth"
      : "matrix";
```

`pairView` has FOUR real values — `"pair-a"` (Matrix), `"pair-b"` (Profile+Curve+Shift),
`"pair-c"` (Forced Flow/Depth, GEX-lens only), and `"pair-d"` (Greeks Distribution, added later
for `GreeksDistributionPanel`/`ThetaDistributionPanel`, "available for all lenses" per its own
tab comment) — but the ternary only ever branched on three of them. `pair-d` had no branch and
silently fell through to the final `: "matrix"` default, the same default `pair-a` (the real
Matrix tab) resolves to.

The PNG-download button (`canCaptureDesk`, gated on `showViewTabs` — true whenever there's a
real block, independent of which `pairView` tab is active) is available on every tab including
`pair-d`, and the rasterized root (`captureRef` / `.thermal-desk-capture-root`) wraps the whole
panel body and is likewise NOT gated on `pairView` — so the captured PNG's actual content is
correctly whatever tab is on screen. Only the derived `captureView` label (and therefore the
downloaded filename) was wrong: a member viewing the Greeks Distribution tab and clicking
"Download PNG" got a file named `thermal-<TICKER>-<lens>-matrix-<date>.png`, misdescribing the
image as the dealer-gamma matrix when it is actually the Greeks concentration distribution panel.

## Evidence

- `thermalCaptureFilename()` (`src/features/thermal/lib/capture-desk-png.ts`) interpolates
  `view` directly into the filename: `` `thermal-${ticker}-${lens}-${view}-${day}.png` ``.
- `ThermalCaptureView` (same file) was `"matrix" | "profile" | "depth" | "grid"` — no
  `"distribution"` member existed at all, so even a correct branch in the ternary would have
  been a type error without first widening the union.
- Confirmed via the TabList that defines `pair-d` (`GexHeatmap.tsx`, "Greeks Distribution is
  available for all lenses" comment) and the `canCaptureDesk`/`captureRef` wiring that the
  download path is reachable, and produces a filename, from every pairView including `pair-d`.
- New regression test
  `src/features/thermal/components/GexHeatmap-capture-view-distribution.test.ts` reproduced the
  gap (RED pre-fix: no `pair-d` branch in the `captureView` ternary, no `"distribution"` member
  on `ThermalCaptureView`) and is GREEN post-fix.

## Blast radius

Single call site: `captureView` is derived once per render in `GexHeatmap.tsx` and consumed only
by `onDownloadCapture()`'s `thermalCaptureFilename({ ticker, lens, view: captureView })` call.
No other component reads `captureView`, and `ThermalCaptureView`'s only other consumer
(`capture-desk-png.test.ts`) only exercises `"matrix"`/`"profile"` — both still pass unchanged.
`ThermalTripleDesk.tsx`'s own PNG path (compare-grid download) is a separate `refreshAndRecenter`
flow and does not use `captureView`, so it was never affected.

## Fix rationale

Added the missing `pairView === "pair-d" ? "distribution" : ...` branch to the ternary, and
widened `ThermalCaptureView` to `"matrix" | "profile" | "depth" | "distribution" | "grid"` so the
new branch type-checks. Minimal, additive change — no existing branch's behavior changed (every
other `pairView`/`compare` combination resolves exactly as before), and no gating logic
(`canCaptureDesk`, `captureRef`) was touched since the actual captured pixels were already
correct; only the derived label was wrong.
