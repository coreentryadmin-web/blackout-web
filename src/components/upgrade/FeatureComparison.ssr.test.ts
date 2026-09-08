import { test } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FEATURE_MATRIX } from "@/lib/upsell-features";
import { MEMBERSHIP_PRICING } from "@/lib/pricing";

// Regression guard for the "SPX Slayer is invisible in its own comparison table" bug: the live
// Pricing page sells three commercial choices (Free, SPX Slayer $49/mo, Premium $199+/mo) but the
// comparison matrix used to render only Free/Premium columns, so a $49 SPX Slayer buyer could not
// see what they'd actually get in the page's primary feature matrix — SPX Slayer's own desk row
// showed "—" (not included) despite SPX Slayer being that exact desk.

(globalThis as unknown as { React: typeof React }).React = React;

async function render(): Promise<string> {
  const { FeatureComparison } = await import("./FeatureComparison");
  return renderToStaticMarkup(React.createElement(FeatureComparison));
}

test("FeatureComparison renders all three purchasable-plan columns", async () => {
  const html = await render();
  assert.ok(html.includes("Free"), "must render a Free column header");
  assert.ok(html.includes("SPX Slayer"), "must render an SPX Slayer column header");
  assert.ok(html.includes("Premium"), "must render a Premium column header");
  assert.ok(
    html.includes(`${MEMBERSHIP_PRICING.community}`),
    "SPX Slayer column must show its real $49 price, not just the plan name"
  );
});

test("FeatureComparison's own SPX Slayer desk row shows SPX Slayer as included, not excluded", async () => {
  const html = await render();
  // The row order in FEATURE_MATRIX puts "SPX Slayer desk" second — split the markup on row
  // boundaries so this assertion checks THAT row's cells, not an unrelated row's "✓".
  const rows = html.split('<div class="min-w-0">');
  const spxRow = rows.find((r) => r.includes("SPX Slayer desk"));
  assert.ok(spxRow, "SPX Slayer desk row must be present");
  // Cells render in Free, SPX Slayer, Premium order; the SPX Slayer cell (2nd of the 3) must be ✓.
  const marks = [...spxRow!.matchAll(/aria-label="(Included|Not included)"/g)].map((m) => m[1]);
  assert.equal(marks.length, 3, "each row renders exactly 3 tier cells");
  assert.equal(marks[0], "Not included", "Free must not include the SPX Slayer desk");
  assert.equal(marks[1], "Included", "SPX Slayer plan must include its own desk");
  assert.equal(marks[2], "Included", "Premium must include the SPX Slayer desk");
});

test("every row's community access implies premium access (premium is a superset)", () => {
  for (const row of FEATURE_MATRIX) {
    if (row.community) {
      assert.ok(row.premium, `"${row.label}" is included for SPX Slayer but not for Premium`);
    }
  }
});
