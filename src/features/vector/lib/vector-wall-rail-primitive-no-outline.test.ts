import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * Regression (member-directed, 2026-09-07): the per-bead paint path in `draw()` must fill a plain
 * circle — magnitude-sized, no stroked outline. `WallRailPrimitive` is a lightweight-charts
 * `ISeriesPrimitive` that only runs against a live chart + canvas context, so it can't be exercised
 * under `tsx --test` (see the file's own header comment) — a source-pattern assertion is the
 * established convention here for exactly this constraint (see vector-chart-viewport.test.ts).
 *
 * This does NOT touch the birth-marker vertical line stroke (`EDGE_ALPHA`, an unrelated event
 * glyph, not a per-bead ring) or the strength halo / integrity-tier fills (separate, unconditional
 * translucent under-layers the member did not ask to change) — only the crisp bordering stroke
 * that used to draw on every bead >= 2.2px radius.
 */
test("WallRailPrimitive.draw: no per-bead outline stroke — beads are plain filled circles", () => {
  const src = read("src/features/vector/lib/vector-wall-rail-primitive.ts");
  const drawStart = src.indexOf("draw(target: PaneRendererTarget)");
  assert.ok(drawStart >= 0, "draw() method not found");
  // Isolate the per-bead loop body (from the fill-alpha computation through the halo/integrity
  // block that precedes the birth/death glyph section) so a stroke elsewhere in the class — e.g.
  // the birth-marker vertical line — can't hide a regression here.
  const loopStart = src.indexOf("const fillA =", drawStart);
  const loopEnd = src.indexOf("// Birth/death:", loopStart);
  assert.ok(loopStart >= 0 && loopEnd > loopStart, "per-bead paint block not found");
  const beadPaintBlock = src.slice(loopStart, loopEnd);
  assert.doesNotMatch(
    beadPaintBlock,
    /ctx\.stroke\(\)/,
    "per-bead paint block must not stroke an outline — beads render as plain filled circles, size-by-magnitude only"
  );
  // Size-by-magnitude must still be intact — only the outline is gone.
  assert.match(beadPaintBlock, /ctx\.arc\(p\.x, cy, r, 0, Math\.PI \* 2\)/);
  assert.match(beadPaintBlock, /ctx\.fill\(\)/);
});
