import { test } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Regression guard: ArticleJsonLd's schema.org Article block previously had no `image` field
// at all — the prop type didn't accept one — even though Google's Article structured-data
// guidelines require it for rich-result/Discover eligibility. All 53 /learn/[slug] guide and
// article pages emitted Article schema with no image as a result, despite each page already
// generating a per-page OG image via /api/og that could have been reused directly.

(globalThis as unknown as { React: typeof React }).React = React;

async function renderArticleJsonLd(image?: string): Promise<Record<string, unknown>> {
  const { ArticleJsonLd } = await import("./JsonLd");
  const html = renderToStaticMarkup(
    React.createElement(ArticleJsonLd, {
      title: "Test Article",
      description: "A test article description.",
      path: "/learn/test-article",
      image,
    }),
  );
  const match = html.match(/<script type="application\/ld\+json">(.*)<\/script>/);
  assert.ok(match, "expected a JSON-LD script tag in the rendered markup");
  return JSON.parse(match[1]);
}

test("ArticleJsonLd emits the passed-in per-page image", async () => {
  const data = await renderArticleJsonLd("https://blackouttrades.com/api/og?title=Test");
  assert.equal(data.image, "https://blackouttrades.com/api/og?title=Test");
});

test("ArticleJsonLd falls back to the site default OG image when none is passed", async () => {
  const data = await renderArticleJsonLd(undefined);
  assert.equal(data.image, "https://blackouttrades.com/og-image.png");
});
