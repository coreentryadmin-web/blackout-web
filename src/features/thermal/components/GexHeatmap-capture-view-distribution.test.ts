/**
 * Regression: the PNG-capture filename must reflect the ACTUAL pairView tab the member is
 * looking at. `captureView`'s ternary only ever distinguished "grid" (compare mode) /
 * "profile" (pair-b) / "depth" (pair-c) — "pair-d" (the Greeks Distribution tab, added for
 * ThetaDistributionPanel/GreeksDistributionPanel) fell through the final `: "matrix"` default,
 * so downloading a PNG snapshot while on the Distribution tab produced a filename claiming
 * `...-matrix-...png` even though the captured image (the whole `thermal-desk-capture-root`,
 * which is NOT gated on pairView) is the distribution panel, not the matrix. Found during the
 * 2026-11-01 thermal-components sweep.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(
  join(process.cwd(), "src/features/thermal/components/GexHeatmap.tsx"),
  "utf8",
);

test("GexHeatmap: captureView maps pair-d to a distribution label, not the matrix default", () => {
  const start = src.indexOf("const captureView: ThermalCaptureView");
  assert.ok(start > 0, "captureView assignment exists");
  const end = src.indexOf("const canCaptureDesk", start);
  assert.ok(end > start, "canCaptureDesk follows captureView");
  const block = src.slice(start, end);

  assert.match(
    block,
    /pairView === "pair-d"\s*\n?\s*\?\s*"distribution"/,
    "pair-d (Greeks Distribution tab) must resolve to its own capture-view label, " +
      "not silently fall through to the pair-a/matrix default",
  );
});

test("capture-desk-png: ThermalCaptureView type carries the distribution variant", () => {
  const libSrc = readFileSync(
    join(process.cwd(), "src/features/thermal/lib/capture-desk-png.ts"),
    "utf8",
  );
  assert.match(
    libSrc,
    /export type ThermalCaptureView = "matrix" \| "profile" \| "depth" \| "distribution" \| "grid";/,
    "ThermalCaptureView must list 'distribution' alongside the other capture views",
  );
});
