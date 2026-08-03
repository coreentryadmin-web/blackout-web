import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sitemapLastModified } from "./sitemap-dates.ts";

describe("sitemapLastModified", () => {
  it("uses guide SEO dates for curriculum slugs", () => {
    const d = sitemapLastModified("/learn/getting-started");
    assert.equal(d.toISOString().slice(0, 10), "2026-08-01");
  });

  it("uses article batch date for learn articles", () => {
    const d = sitemapLastModified("/learn/what-is-gex");
    assert.equal(d.toISOString().slice(0, 10), "2026-08-02");
  });

  it("uses marketing dates for homepage", () => {
    const d = sitemapLastModified("/");
    assert.equal(d.toISOString().slice(0, 10), "2026-08-02");
  });
});
