import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GUIDE_SEO } from "./guide-seo";

// Companion to the same check in articles.test.ts — Google truncates SERP snippets around
// ~155-160 chars, so a metaDescription over that limit cuts off mid-sentence in results.
describe("curriculum guides — meta description length", () => {
  it("no guide metaDescription exceeds 160 characters", () => {
    const violations = Object.entries(GUIDE_SEO)
      .filter(([, g]) => g.metaDescription.length > 160)
      .map(([slug, g]) => `${slug}: ${g.metaDescription.length} chars`);
    assert.equal(
      violations.length,
      0,
      `Guides with metaDescription over 160 chars (will truncate in SERPs):\n  ${violations.join("\n  ")}`
    );
  });
});

// Regression for a P3 finding (2026-09-04): GUIDE_SEO's night-hawk entry described the chapter
// in its <title> and meta description as "Swing Trading Setups Explained" / "grades swing trading
// setups and runs its evening scanner" — a second, independent copy of the same stale "evening/
// swing-only" framing already fixed in LEARN_NAV's night-hawk descriptor (nav.ts) and in
// PRODUCT_MANIFEST.hawk (product-manifest.ts, which carries a standing "Never describe Night Hawk
// as swing-only" comment). This one is the highest-visibility of the three: it's the literal
// <title> tag and SERP snippet a prospective member sees before ever loading the page.
describe("night-hawk guide SEO metadata", () => {
  it("does not describe Night Hawk as swing-only or evening-only", () => {
    const nightHawk = GUIDE_SEO["night-hawk"];
    assert.doesNotMatch(nightHawk.metaTitle, /swing trading/i);
    assert.doesNotMatch(nightHawk.metaDescription, /swing trading|evening scanner/i);
    assert.match(nightHawk.metaTitle, /0DTE/i);
  });
});
