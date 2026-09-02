import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sitemapLastModified } from "./sitemap-dates.ts";
import { MARKETING_DATES } from "./marketing-dates.ts";

describe("sitemapLastModified", () => {
  it("uses guide SEO dates for curriculum slugs", () => {
    const d = sitemapLastModified("/learn/getting-started");
    assert.equal(d.toISOString().slice(0, 10), "2026-08-01");
  });

  it("uses article batch date for learn articles", () => {
    const d = sitemapLastModified("/learn/what-is-gex");
    assert.equal(d.toISOString().slice(0, 10), "2026-08-03");
  });

  it("uses the git-derived marketing date for the homepage", () => {
    // Asserted against MARKETING_DATES itself, not a literal — a literal here would go stale
    // the exact way the hardcoded map this replaced did (2026-08-02 vs. a real 2026-09-01 last
    // change, see marketing-dates.ts's header comment).
    const d = sitemapLastModified("/");
    assert.equal(d.toISOString().slice(0, 10), MARKETING_DATES["/"]);
  });
});
