/**
 * Regression guard for the unrounded-floats bug in the GEX matrix-deltas SSE snapshot
 * (2026-09-03). The initial `snapshot` event served `fetchGexHeatmap`'s raw arithmetic output
 * directly — the same dollar-gamma sums that carry IEEE-754 float noise (e.g.
 * `7499.360000000001`) `round-floats.ts` exists to strip at the response boundary — while the
 * sibling REST route (`gex-heatmap/route.ts`) already rounds the same underlying heatmap object
 * before serving it. A member connecting to the SSE feed saw raw floats on first paint even
 * though a plain REST fetch of the same ticker's matrix was already clean.
 *
 * This route is an SSE handler with auth/streaming setup that isn't practical to unit-test in
 * isolation, so this is a source-text regression guard (same idiom used elsewhere in this repo
 * for a route/component that can't easily be exercised directly) confirming the fix is wired in.
 * The actual rounding MATH is covered behaviorally in gex-matrix-delta.test.ts (for the delta
 * broadcast path) — this file only confirms the SNAPSHOT path applies the same treatment.
 * Run: `npx tsx --test src/app/api/market/gex-matrix-deltas/route.test.ts`
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/app/api/market/gex-matrix-deltas/route.ts"), "utf8");

test("gex-matrix-deltas route: imports roundFloats + the strike-total reconcilers", () => {
  assert.match(
    src,
    /import\s*\{\s*roundFloats,\s*reconcileStrikeTotal,\s*reconcileCellStrikeTotals\s*\}\s*from\s*"@\/lib\/round-floats"/
  );
});

test("gex-matrix-deltas route: the SSE snapshot is built from a rounded object, not the raw fetch", () => {
  assert.match(
    src,
    /const snapshot = roundFloats\(rawSnapshot\);/,
    "the snapshot sent to clients must be the rounded value, not fetchGexHeatmap's raw output"
  );
  // All four metrics gex-heatmap's own REST route reconciles must get the same treatment here.
  for (const metric of ["gex", "vex", "dex", "charm"]) {
    assert.match(
      src,
      new RegExp(`snapshot\\.${metric} = reconcileStrikeTotal\\(reconcileCellStrikeTotals\\(snapshot\\.${metric}`),
      `${metric} must be reconciled the same way gex-heatmap/route.ts reconciles it`
    );
  }
});

test("gex-matrix-deltas route: the SSE payload references the rounded snapshot variable", () => {
  const idx = src.indexOf("const snapshotEvent");
  assert.ok(idx > 0, "snapshot event construction exists");
  const body = src.slice(idx, idx + 300);
  assert.match(body, /data: snapshot,/, "the event payload must use the rounded `snapshot`, not `rawSnapshot`");
});
