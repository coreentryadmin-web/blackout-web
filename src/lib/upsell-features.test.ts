import { test } from "node:test";
import assert from "node:assert/strict";
import { FEATURE_MATRIX } from "./upsell-features";

// Product sigils render off row.mark, NOT a separate label->mark map keyed on
// display copy (that drift is exactly what broke every sigil before). These
// guards fail the build if the matrix loses its product marks or a copy edit
// orphans a sigil. Run: npx tsx --test src/lib/upsell-features.test.ts

const VALID_MARKS = new Set(["spx", "helix", "heatmap", "largo", "nighthawk"]);

test("the five product rows each carry a valid mark", () => {
  const productLabels = [
    "HELIX live flow feed",
    "SPX Slayer desk",
    "Largo AI desk analyst",
    "Night Hawk evening playbook",
    "Strike-level heatmaps",
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

test("the AuthProofRail slice (first 4 rows) all carry a sigil", () => {
  // AuthProofRail renders FEATURE_MATRIX.slice(0, 4); each should show a sigil
  // rather than the generic ✓ fallback.
  for (const row of FEATURE_MATRIX.slice(0, 4)) {
    assert.ok(row.mark, `proof-rail row "${row.label}" must carry a mark`);
  }
});
