import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const homeSrc = readFileSync(join(root, "src/components/landing/RedesignHome.tsx"), "utf8");
const pricingSrc = readFileSync(join(root, "src/components/landing/RedesignPricing.tsx"), "utf8");

// Regression for a P1 finding (2026-09-02): the homepage pricing grid — the highest-traffic
// purchase surface — quoted the same "Cancel anytime · No contracts" trust line under all three
// cards, so the Premium Yearly card silently dropped the 7-day money-back guarantee that
// /pricing and /refund-policy both promise for annual plans. That's a real contractual benefit a
// buyer isn't told about at the point of purchase, not a cosmetic copy gap.
test("homepage's Premium Yearly card states the 7-day money-back guarantee, matching /pricing", () => {
  const yearlyCardMatch = homeSrc.match(/Premium Yearly.*?\{\/\* Premium Yearly[\s\S]*?<\/div>\s*<\/div>/);
  // Fall back to a looser scan if the JSX comment shape ever changes — what matters is that the
  // string appears somewhere alongside the yearly plan's other markup, not the exact JSX path.
  const yearlySection = yearlyCardMatch ? yearlyCardMatch[0] : homeSrc.slice(homeSrc.indexOf("Premium Yearly"), homeSrc.indexOf("Premium Yearly") + 2000);
  assert.match(yearlySection, /7-day money-back guarantee/i, "homepage yearly pricing card must state the 7-day guarantee");
  assert.match(pricingSrc, /7-day money-back guarantee/i, "/pricing must still state the 7-day guarantee (wording anchor)");
});

// Monthly plans are explicitly non-refundable per /refund-policy — the guarantee line must never
// spread to the monthly/SPX Slayer cards, which would misstate the refund policy in the other
// direction.
test("homepage's monthly-billed cards (SPX Slayer, Premium monthly) do not claim a money-back guarantee", () => {
  const priceGridMatch = homeSrc.match(/<div className="price-grid">[\s\S]*?<\/div>\s*<\/div>\s*<\/section>/);
  const priceGrid = priceGridMatch ? priceGridMatch[0] : homeSrc;
  const trustLines = [...priceGrid.matchAll(/<p className="trust">([^<]*)<\/p>/g)].map((m) => m[1]);
  assert.equal(trustLines.length, 3, "expected exactly 3 pricing-card trust lines (SPX Slayer, Premium monthly, Premium yearly)");
  const [spxTrust, monthlyTrust, yearlyTrust] = trustLines;
  assert.doesNotMatch(spxTrust, /money-back/i);
  assert.doesNotMatch(monthlyTrust, /money-back/i);
  assert.match(yearlyTrust, /money-back/i);
});
