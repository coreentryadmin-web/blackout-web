import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sitemapLastModified } from "./sitemap-dates.ts";
import { MARKETING_DATES } from "./marketing-dates.ts";
import { ARTICLE_DATES } from "@/lib/learn/article-dates";

describe("sitemapLastModified", () => {
  it("uses guide SEO dates for curriculum slugs", () => {
    const d = sitemapLastModified("/learn/getting-started");
    assert.equal(d.toISOString().slice(0, 10), "2026-08-01");
  });

  it("uses article batch date for learn articles", () => {
    // Asserted against ARTICLE_DATES itself, not a literal — a hardcoded literal here goes
    // stale every time article-dates.ts is regenerated from git history (as documented in its
    // own header), which is exactly the staleness bug the homepage test below was written to
    // avoid. Caught 2026-09-02 when an unrelated content commit's required regeneration made
    // this assertion's old "2026-08-03" literal go stale within the same PR cycle.
    const d = sitemapLastModified("/learn/what-is-gex");
    assert.equal(d.toISOString().slice(0, 10), ARTICLE_DATES["what-is-gex"].dateModified);
  });

  it("uses the git-derived marketing date for the homepage", () => {
    // Asserted against MARKETING_DATES itself, not a literal — a literal here would go stale
    // the exact way the hardcoded map this replaced did (2026-08-02 vs. a real 2026-09-01 last
    // change, see marketing-dates.ts's header comment).
    const d = sitemapLastModified("/");
    assert.equal(d.toISOString().slice(0, 10), MARKETING_DATES["/"]);
  });
});
