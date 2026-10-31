import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  feedLastModifiedForArticle,
  feedPubDateForArticle,
  sitemapLastModified,
} from "./sitemap-dates.ts";
import { MARKETING_DATES } from "./marketing-dates.ts";
import { ARTICLE_DATES } from "@/lib/learn/article-dates";
import { GUIDE_SEO } from "@/lib/learn/guide-seo";

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

describe("feedPubDateForArticle", () => {
  // Regression for the RSS <pubDate> bug: this must report WHEN THE ARTICLE WAS PUBLISHED
  // (datePublished), never when it was last edited (dateModified) — otherwise a routine content
  // fix on a months-old article moves its RSS pubDate forward and misrepresents an edit as a
  // brand-new post. Picks a real slug whose two dates genuinely differ, so a regression back to
  // reading dateModified would actually change the asserted value rather than passing by luck.
  it("uses datePublished, not dateModified, for a regular learn article", () => {
    const slug = "dealer-gamma-options-flow-guide";
    const dates = ARTICLE_DATES[slug];
    assert.ok(dates, `fixture slug ${slug} must exist in ARTICLE_DATES`);
    assert.notEqual(
      dates.datePublished,
      dates.dateModified,
      "fixture must have genuinely different published/modified dates to be a real regression guard"
    );
    const pubDate = feedPubDateForArticle(slug);
    assert.equal(pubDate, new Date(`${dates.datePublished}T12:00:00Z`).toUTCString());
    assert.notEqual(pubDate, new Date(`${dates.dateModified}T12:00:00Z`).toUTCString());
  });

  it("uses datePublished, not dateModified, for a curriculum guide slug", () => {
    const slug = "getting-started";
    const seo = GUIDE_SEO[slug];
    assert.notEqual(
      seo.datePublished,
      seo.dateModified,
      "fixture must have genuinely different published/modified dates to be a real regression guard"
    );
    const pubDate = feedPubDateForArticle(slug);
    assert.equal(pubDate, new Date(`${seo.datePublished}T12:00:00Z`).toUTCString());
    assert.notEqual(pubDate, new Date(`${seo.dateModified}T12:00:00Z`).toUTCString());
  });
});

describe("feedLastModifiedForArticle", () => {
  // The channel-level <lastBuildDate> sibling legitimately wants the EDIT date (unlike the item
  // pubDate above) — pin that it still reads dateModified so the two functions don't silently
  // converge on the same field again.
  it("uses dateModified for a regular learn article", () => {
    const slug = "dealer-gamma-options-flow-guide";
    const dates = ARTICLE_DATES[slug];
    assert.equal(
      feedLastModifiedForArticle(slug),
      new Date(`${dates.dateModified}T12:00:00Z`).toUTCString()
    );
  });

  it("uses dateModified for a curriculum guide slug", () => {
    const slug = "getting-started";
    const seo = GUIDE_SEO[slug];
    assert.equal(
      feedLastModifiedForArticle(slug),
      new Date(`${seo.dateModified}T12:00:00Z`).toUTCString()
    );
  });
});
