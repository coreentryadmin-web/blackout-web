import { test } from "node:test";
import assert from "node:assert/strict";
import { FEATURE_MATRIX } from "./upsell-features";
import type { MarkProduct } from "@/components/marks/ProductMark";

// Product sigils render off row.mark, NOT a separate label->mark map keyed on
// display copy (that drift is exactly what broke every sigil before). These
// guards fail the build if the matrix loses its product marks or a copy edit
// orphans a sigil. Run: npx tsx --test src/lib/upsell-features.test.ts

const VALID_MARKS = new Set<MarkProduct>([
  "spx",
  "helix",
  "heatmap",
  "largo",
  "nighthawk",
  "vector",
]);

/** Premium product rows that must carry a sigil — labels track product-manifest copy. */
const PRODUCT_ROWS: Array<{ label: string; mark: MarkProduct }> = [
  { label: "HELIX live flow feed", mark: "helix" },
  { label: "SPX Slayer desk", mark: "spx" },
  { label: "Largo AI desk analyst", mark: "largo" },
  { label: "Night Hawk 0DTE Command", mark: "nighthawk" },
  { label: "Vector universe scanner", mark: "vector" },
  { label: "Strike-level heatmaps", mark: "heatmap" },
];

test("premium product rows each carry a valid mark", () => {
  for (const { label, mark } of PRODUCT_ROWS) {
    const row = FEATURE_MATRIX.find((r) => r.label === label);
    assert.ok(row, `FEATURE_MATRIX is missing the product row "${label}"`);
    assert.equal(row!.mark, mark, `row "${label}" must carry mark "${mark}"`);
    assert.ok(VALID_MARKS.has(row!.mark!), `unknown mark on "${label}"`);
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

test("the AuthProofRail slice (first 4 rows) all carry a sigil", () => {
  // AuthProofRail renders FEATURE_MATRIX.slice(0, 4); each should show a sigil
  // rather than the generic ✓ fallback.
  for (const row of FEATURE_MATRIX.slice(0, 4)) {
    assert.ok(row.mark, `proof-rail row "${row.label}" must carry a mark`);
  }
});
