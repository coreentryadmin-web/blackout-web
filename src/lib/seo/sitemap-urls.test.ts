import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEARN_ARTICLES } from "../learn/articles.ts";
import { publicSitemapEntries } from "./sitemap-urls.ts";

describe("publicSitemapEntries", () => {
  it("includes every learn article path", () => {
    const paths = new Set(publicSitemapEntries().map((e) => e.path));
    for (const article of LEARN_ARTICLES) {
      assert.ok(paths.has(article.path), `missing sitemap path ${article.path}`);
    }
  });

  it("matches article count plus marketing, curriculum, and legal", () => {
    const entries = publicSitemapEntries();
    assert.ok(entries.length >= 42 + 7 + 5);
  });
});
