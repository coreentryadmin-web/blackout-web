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
