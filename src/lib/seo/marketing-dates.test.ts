import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publicSitemapEntries } from "./sitemap-urls.ts";
import { MARKETING_DATES } from "./marketing-dates.ts";

// Regression guard for the search-index staleness finding (2026-09-02, coordinator handoff):
// MARKETING_DATES used to be a hand-maintained literal map, and it went stale by a full month on
// the homepage — hardcoded at 2026-08-02 while the real last content change (PR #3307, the
// 6->7 product-catalog migration) landed 2026-09-02. A stale sitemap lastmod is a real signal to
// Googlebot that a page hasn't changed, which plausibly explains why a search-index snapshot was
// still serving the old 6-engine copy well after the live page was already correct.
// marketing-dates.ts is now generated from real git history (scripts/seo/generate-marketing-dates.mjs)
// — these tests guard against it going stale relative to sitemap-urls.ts and re-drifting into a
// hardcoded literal.

const NON_LEARN_LEGAL_PATHS = new Set([
  "/terms",
  "/privacy",
  "/disclaimer",
  "/refund-policy",
  "/cookie-policy",
]);

function marketingPaths(): string[] {
  return publicSitemapEntries()
    .map((e) => e.path)
    .filter((p) => p === "/learn" || !p.startsWith("/learn/"))
    .filter((p) => !NON_LEARN_LEGAL_PATHS.has(p));
}

describe("MARKETING_DATES", () => {
  it("has an entry for every marketing page in sitemap-urls.ts (no stale/missing paths)", () => {
    const sitemapPaths = new Set(marketingPaths());
    const dateKeys = new Set(Object.keys(MARKETING_DATES));

    for (const path of sitemapPaths) {
      assert.ok(
        dateKeys.has(path),
        `MARKETING_DATES is missing an entry for "${path}" — regenerate with scripts/seo/generate-marketing-dates.mjs`,
      );
    }
    for (const path of dateKeys) {
      assert.ok(
        sitemapPaths.has(path),
        `MARKETING_DATES has a stale entry for "${path}" which is no longer a marketing page in sitemap-urls.ts`,
      );
    }
  });

  it("every entry is a well-formed ISO date", () => {
    const isoDate = /^\d{4}-\d{2}-\d{2}$/;
    for (const [path, date] of Object.entries(MARKETING_DATES)) {
      assert.match(date, isoDate, `${path} date "${date}" is not YYYY-MM-DD`);
    }
  });

  it("the homepage date is not the known-stale literal this finding replaced", () => {
    // The specific regression this guards: MARKETING_DATES["/"] hardcoded to "2026-08-02" while
    // the real last change was a month later. Any future date is fine as long as it is not this
    // exact stale literal reappearing (e.g. from a careless hand-edit reverting the generated file).
    assert.notEqual(MARKETING_DATES["/"], "2026-08-02");
  });
});
