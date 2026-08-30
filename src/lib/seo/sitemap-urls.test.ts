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

  it("includes the public methodology / trust page", () => {
    const paths = new Set(publicSitemapEntries().map((e) => e.path));
    assert.ok(paths.has("/methodology"));
  });

  it("does not include research gamma-levels paths while licensing is unresolved", () => {
    const paths = publicSitemapEntries().map((e) => e.path);
    const research = paths.filter((p) => p.startsWith("/research/gamma-levels"));
    assert.equal(research.length, 0);
  });

  it("matches article count plus marketing, curriculum, and legal", () => {
    const entries = publicSitemapEntries();
    assert.ok(entries.length >= 45 + 7 + 5);
  });
});
