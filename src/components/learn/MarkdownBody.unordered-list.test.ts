import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
(globalThis as unknown as { React: typeof React }).React = React;

// Real content shape from src/app/(marketing)/about/page.tsx's TOOLS block and the bulk of
// src/lib/learn/articles.ts (187 occurrences) — a markdown unordered list using `- **Term** — def`.
// MarkdownBody previously had no branch for `-`/`*` bullets (only `\d+\. ` ordered lists), so a
// block like this fell through to the plain-<p> branch and rendered the literal leading `- `
// dashes as part of the paragraph text instead of a real <ul><li> list.
test("MarkdownBody renders a `- ` unordered list as real <ul><li> markup, not literal dashes in a paragraph", async () => {
  const { MarkdownBody } = await import("./MarkdownBody");
  const md = `- **SPX Slayer** — The 0DTE command center.
- **Thermal** — GEX, VEX, DEX, and CHARM heatmaps.
- **HELIX** — Institutional flow scanner.`;

  const html = renderToStaticMarkup(React.createElement(MarkdownBody, { content: md }));

  assert.match(html, /<ul[^>]*>/, "must render a real <ul>");
  assert.match(html, /<li[^>]*><strong>SPX Slayer<\/strong>/, "first item must be a <li>, bold term preserved");
  assert.match(html, /<li[^>]*><strong>Thermal<\/strong>/);
  assert.match(html, /<li[^>]*><strong>HELIX<\/strong>/);
  // The bug's symptom: literal markdown bullet syntax leaking into the rendered text.
  assert.doesNotMatch(html, />-\s*<strong>/, "must not render a literal leading '- ' before the item text");
});

test("MarkdownBody still renders plain prose paragraphs normally (no false-positive list detection)", async () => {
  const { MarkdownBody } = await import("./MarkdownBody");
  const md = `This is a normal paragraph with an em dash — not a list — in the middle of it.`;

  const html = renderToStaticMarkup(React.createElement(MarkdownBody, { content: md }));
  assert.match(html, /<p[^>]*>/);
  assert.doesNotMatch(html, /<ul/);
});
