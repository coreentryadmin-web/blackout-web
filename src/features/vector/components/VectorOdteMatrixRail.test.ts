import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "src/features/vector");

// Regression guard for the operator's UI complaint (2026-08-27 screenshot feedback on the
// 0DTE MATRIX rail on /vector): "why don't we paint the King node GEX value yellow?" and
// "why don't we keep the Delta % on GEX itself rather than wasting space?" — SPX Slayer's
// dealer gamma map (SpxGexMatrixHeatmap) already keeps the shift/drift reading folded next
// to the value it explains instead of a whole separate column, and marks its King cell with
// a gold star; this rail previously spent an entire THIRD table column on Δ% alone and left
// the King row's GEX value colored the same green/red as every other row (only a white
// "anchor" box-shadow frame set it apart, which is easy to miss scanning fast).
test("VectorOdteMatrixRail: king GEX value is gold and Δ% is folded into the GEX cell, not its own column", () => {
  const src = readFileSync(join(root, "components/VectorOdteMatrixRail.tsx"), "utf8");

  // Only two <th> header cells in the matrix table's <thead> now (Strike, GEX·Δ%) — Δ% no
  // longer gets a standalone column header. (Row headers use <th scope="row"> for the strike
  // cell itself, so scope the count to just the <thead> block.)
  const theadMatch = src.match(/<thead[\s\S]*?<\/thead>/);
  assert.ok(theadMatch, "matrix table must have a <thead>");
  const headerCells = [...theadMatch![0].matchAll(/<th\b[^>]*>/g)];
  assert.equal(
    headerCells.length,
    2,
    "matrix table header must carry exactly two columns (Strike, GEX) now that Δ% is folded inline"
  );
  assert.doesNotMatch(
    src,
    /<th className="py-1 pr-1 text-right font-semibold">Δ%<\/th>/,
    "Δ% must no longer render as its own <th> column"
  );

  // The King row's GEX value is painted with the gold token, not left to the generic
  // green/red value coloring + white anchor frame alone.
  assert.match(
    src,
    /row\.isKing && "vector-odte-matrix-king-value"/,
    "king row's GEX value span must apply the king-gold class"
  );

  // Δ% now renders as an inline suffix inside the GEX <td>, not a sibling <td>.
  assert.match(
    src,
    /vector-odte-matrix-pct-inline/,
    "Δ% must render inline (folded into the GEX cell) via the pct-inline class"
  );
  const gexCellMatch = src.match(
    /<td\s+className="py-0\.5 pr-1 text-right whitespace-nowrap"[\s\S]*?<\/td>/
  );
  assert.ok(gexCellMatch, "GEX cell markup must exist");
  assert.match(
    gexCellMatch![0],
    /vector-odte-matrix-pct-inline/,
    "Δ% inline suffix must live INSIDE the GEX <td>, confirming the two are the same cell"
  );
});
