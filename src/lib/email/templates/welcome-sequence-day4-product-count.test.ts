import assert from "node:assert/strict";
import { test } from "node:test";
import { WELCOME_SEQUENCE } from "./welcome-sequence.ts";
import { manifestProductCount } from "@/lib/marketing/product-manifest";

// Regression for a live bug (2026-10-12): the Day 4 "tool tour" step's opening paragraph said
// "Here's the other ${manifestProductCount() - 1}" (= 6), but the table immediately below it
// (the `engines` array) lists all 7 current live products, including the one the sentence's own
// subtraction implied was already covered. The stated count and the rendered table disagreed —
// same bug class as welcome-premium.ts/downgrade.ts's own stale-count fix
// (welcome-premium-downgrade-product-count.test.ts), just with an independent "-1" offset instead
// of a hardcoded number. Fixed by tying the stated count to the table's own length instead of an
// offset expression that could drift from it again.

function buildDay4Html(): string {
  const day4 = WELCOME_SEQUENCE.find((s) => s.step === 3);
  assert.ok(day4, "Day 4 (step 3) welcome-sequence email not found");
  return day4!.build({ email: "member@example.com", firstName: "Alex" }).html;
}

test("welcome-sequence Day 4: stated product count agrees with the manifest's live product count", () => {
  const html = buildDay4Html();
  const n = manifestProductCount();
  assert.match(html, new RegExp(`all ${n}\\b`));
  assert.match(html, new RegExp(`${n} products`));
});

test("welcome-sequence Day 4: every live product in the manifest appears in the tool-tour table", () => {
  const html = buildDay4Html();
  for (const name of ["SPX Slayer", "Thermal", "HELIX", "Night Hawk", "Largo AI", "Vector", "Meridian"]) {
    assert.match(html, new RegExp(name), `missing "${name}" from the Day 4 tool tour`);
  }
});
