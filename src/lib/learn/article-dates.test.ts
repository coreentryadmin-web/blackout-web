import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEARN_ARTICLES } from "./articles.ts";
import { ARTICLE_DATES } from "./article-dates.ts";

// Regression guard for the uniform-article-dates finding (docs/audit/FINDINGS.md, 2026-08-08):
// all 45 learn articles used to share the exact same datePublished/dateModified pair, reading
// as a batch content dump instead of organically maintained content. article-dates.ts is
// generated from real git history (scripts/seo/generate-article-dates.mjs) — these tests both
// guard against it going stale relative to articles.ts and prove the fix actually produced real
// differentiation, not just a refactor with the same uniform value moved to a new file.

describe("ARTICLE_DATES", () => {
  it("has an entry for every article in LEARN_ARTICLES (no stale/missing slugs)", () => {
    const articleSlugs = new Set(LEARN_ARTICLES.map((a) => a.slug));
    const dateSlugs = new Set(Object.keys(ARTICLE_DATES));

    for (const slug of articleSlugs) {
      assert.ok(dateSlugs.has(slug), `ARTICLE_DATES is missing an entry for "${slug}" — regenerate with scripts/seo/generate-article-dates.mjs`);
    }
    for (const slug of dateSlugs) {
      assert.ok(articleSlugs.has(slug), `ARTICLE_DATES has a stale entry for "${slug}" which no longer exists in LEARN_ARTICLES`);
    }
  });

  it("every entry has well-formed ISO dates with datePublished <= dateModified", () => {
    const isoDate = /^\d{4}-\d{2}-\d{2}$/;
    for (const [slug, { datePublished, dateModified }] of Object.entries(ARTICLE_DATES)) {
      assert.match(datePublished, isoDate, `${slug} datePublished is not YYYY-MM-DD`);
      assert.match(dateModified, isoDate, `${slug} dateModified is not YYYY-MM-DD`);
      assert.ok(datePublished <= dateModified, `${slug} datePublished (${datePublished}) is after dateModified (${dateModified})`);
    }
  });

  it("articles are not all stamped with the same date (real differentiation, not a uniform batch value)", () => {
    const distinctDatePublished = new Set(Object.values(ARTICLE_DATES).map((d) => d.datePublished));
    const distinctDateModified = new Set(Object.values(ARTICLE_DATES).map((d) => d.dateModified));
    assert.ok(distinctDatePublished.size > 1, "expected more than one distinct datePublished across articles");
    assert.ok(distinctDateModified.size > 1, "expected more than one distinct dateModified across articles");
  });
});
