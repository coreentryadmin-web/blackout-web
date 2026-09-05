import { test } from "node:test";
import assert from "node:assert/strict";
import { FEATURE_MATRIX } from "./upsell-features";
import type { MarkProduct } from "@/components/marks/ProductMark";
import { PLAN_MATRIX } from "./plan-matrix";
import { DESK_TIER_REQUIREMENTS } from "./desk-tier-requirements";
import { tierAtLeast } from "./tiers";
import type { ToolKey } from "./tool-access";

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
  { label: "Thermal dealer-gamma heatmaps", mark: "heatmap" },
  { label: "Vector universe scanner", mark: "vector" },
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
    "Night Hawk 0DTE Command",
    "Thermal dealer-gamma heatmaps",
    "Vector universe scanner",
    "Meridian catalyst desk",
  ]) {
    assert.ok(visible.includes(label), `proof-rail slice is missing "${label}"`);
  }
});

test("Meridian's row has no mark (no MarkProduct entry exists for it) — falls back to the ✓ honestly", () => {
  const row = FEATURE_MATRIX.find((r) => r.label === "Meridian catalyst desk");
  assert.ok(row, "FEATURE_MATRIX is missing the Meridian row");
  assert.equal(row.mark, undefined);
});

/** Desk rows whose community/premium access must come from DESK_TIER_REQUIREMENTS — the
 *  manifest desk-tier-requirements.test.ts verifies against each desk's real layout.tsx gate. */
const DESK_ROWS: Array<{ label: string; key: ToolKey }> = [
  { label: "HELIX live flow feed", key: "flows" },
  { label: "SPX Slayer desk", key: "spx" },
  { label: "Largo AI desk analyst", key: "largo" },
  { label: "Night Hawk 0DTE Command", key: "nighthawk" },
  { label: "Thermal dealer-gamma heatmaps", key: "heatmap" },
  { label: "Vector universe scanner", key: "vector" },
  { label: "Meridian catalyst desk", key: "meridian" },
];

test("every desk row's community/premium access matches DESK_TIER_REQUIREMENTS — no manual override can drift from the real gate", () => {
  for (const { label, key } of DESK_ROWS) {
    const row = FEATURE_MATRIX.find((r) => r.label === label);
    assert.ok(row, `FEATURE_MATRIX is missing "${label}"`);
    const minTier = DESK_TIER_REQUIREMENTS[key];
    assert.equal(
      row!.community,
      tierAtLeast("community", minTier),
      `"${label}" community access disagrees with DESK_TIER_REQUIREMENTS["${key}"] = "${minTier}"`
    );
    assert.equal(
      row!.premium,
      tierAtLeast("premium", minTier),
      `"${label}" premium access disagrees with DESK_TIER_REQUIREMENTS["${key}"] = "${minTier}"`
    );
  }
});

// SPX Slayer's own product page (RedesignPricing.tsx) lists its perks straight from
// PLAN_MATRIX.spx_slayer.includes. Two FEATURE_MATRIX rows aren't backed by a code-level route
// gate (graded plays are a display feature inside desk pages; Discord is an external invite) —
// their "included for SPX Slayer" claim is only as good as this cross-check against the plan's
// own canonical perk list, so if plan-matrix.ts ever drops these perks this test forces the
// comparison table to be revisited rather than silently overselling the $49 tier.
test("hand-set SPX Slayer rows (no code-level gate) stay backed by PLAN_MATRIX.spx_slayer.includes", () => {
  const includes = PLAN_MATRIX.spx_slayer.includes.join(" | ");
  assert.ok(
    /0DTE graded plays/i.test(includes),
    "PLAN_MATRIX.spx_slayer no longer promises 0DTE graded plays — update or remove that FEATURE_MATRIX row"
  );
  assert.ok(
    /Discord/i.test(includes),
    "PLAN_MATRIX.spx_slayer no longer promises Discord access — update or remove that FEATURE_MATRIX row"
  );

  const gradedPlaysRow = FEATURE_MATRIX.find((r) => r.label === "0DTE graded plays");
  assert.ok(gradedPlaysRow, "FEATURE_MATRIX is missing the graded-plays row");
  assert.equal(gradedPlaysRow!.community, true);

  const discordRow = FEATURE_MATRIX.find((r) => r.label === "Private Discord access");
  assert.ok(discordRow, "FEATURE_MATRIX is missing the Discord row");
  assert.equal(discordRow!.community, true);
});
