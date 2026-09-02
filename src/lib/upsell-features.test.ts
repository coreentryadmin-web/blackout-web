import { test } from "node:test";
import assert from "node:assert/strict";
import { FEATURE_MATRIX } from "./upsell-features";

// Product sigils render off row.mark, NOT a separate label->mark map keyed on
// display copy (that drift is exactly what broke every sigil before). These
// guards fail the build if the matrix loses its product marks or a copy edit
// orphans a sigil. Run: npx tsx --test src/lib/upsell-features.test.ts

const VALID_MARKS = new Set(["spx", "helix", "heatmap", "largo", "nighthawk", "vector"]);

// The 6 desk products with a dedicated ProductMark sigil. Meridian has no
// MarkProduct entry (ProductMark.tsx's MarkProduct union has no "meridian" —
// its row falls back to the generic ✓, same as the non-desk feature rows).
test("the six marked product rows each carry a valid mark", () => {
  const productLabels = [
    "HELIX live flow feed",
    "SPX Slayer desk",
    "Largo AI desk analyst",
    "Night Hawk overnight + 0DTE scanner",
    "Thermal dealer-gamma heatmaps",
    "Vector cross-ticker scanner",
  ];
  for (const label of productLabels) {
    const row = FEATURE_MATRIX.find((r) => r.label === label);
    assert.ok(row, `FEATURE_MATRIX is missing the product row "${label}"`);
    assert.ok(
      row.mark && VALID_MARKS.has(row.mark),
      `row "${label}" must carry a valid product mark, got ${String(row.mark)}`
    );
  }
});

test("every mark present on any row is a valid MarkProduct", () => {
  for (const row of FEATURE_MATRIX) {
    if (row.mark != null) {
      assert.ok(
        VALID_MARKS.has(row.mark),
        `row "${row.label}" has an unknown mark "${row.mark}"`
      );
    }
  }
});

// AuthProofRail renders FEATURE_MATRIX.slice(0, 7) on sign-up/sign-in — this must
// cover all 7 desk products (SPX Slayer, HELIX, Largo, Night Hawk, Thermal,
// Vector, Meridian), not just the first 4. A signup page that only advertises
// 4 of 7 products is underselling Premium at the moment closest to conversion.
test("the AuthProofRail slice (first 7 rows) covers every desk product", () => {
  const visible = FEATURE_MATRIX.slice(0, 7).map((r) => r.label);
  for (const label of [
    "HELIX live flow feed",
    "SPX Slayer desk",
    "Largo AI desk analyst",
    "Night Hawk overnight + 0DTE scanner",
    "Thermal dealer-gamma heatmaps",
    "Vector cross-ticker scanner",
    "Meridian earnings intelligence",
  ]) {
    assert.ok(visible.includes(label), `proof-rail slice is missing "${label}"`);
  }
});

test("Meridian's row has no mark (no MarkProduct entry exists for it) — falls back to the ✓ honestly", () => {
  const row = FEATURE_MATRIX.find((r) => r.label === "Meridian earnings intelligence");
  assert.ok(row, "FEATURE_MATRIX is missing the Meridian row");
  assert.equal(row.mark, undefined);
});
