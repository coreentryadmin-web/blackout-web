import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
(globalThis as unknown as { React: typeof React }).React = React;

test("MarkdownBody renders a standalone image block as a CLS-safe <figure> with caption", async () => {
  const { MarkdownBody } = await import("./MarkdownBody.tsx");
  const md = "Intro paragraph.\n\n![A diagram](/images/diagrams/gamma-flip.svg)\n*Above the flip, moves dampen.*\n\nMore text.";
  const html = renderToStaticMarkup(React.createElement(MarkdownBody, { content: md }));

  assert.ok(html.includes("<figure"), "image renders as a figure");
  assert.ok(html.includes('src="/images/diagrams/gamma-flip.svg"'));
  assert.ok(html.includes('alt="A diagram"'), "alt text preserved");
  // width + height MUST be present so the browser reserves space — no layout shift (CLS guard).
  assert.ok(/width="1200"/.test(html) && /height="630"/.test(html), "explicit dimensions for CLS safety");
  assert.ok(html.includes("Above the flip"), "caption rendered");
  // surrounding prose still renders as paragraphs
  assert.ok(html.includes("Intro paragraph.") && html.includes("More text."));
});

test("a normal link is NOT mistaken for an image block", async () => {
  const { MarkdownBody } = await import("./MarkdownBody.tsx");
  const html = renderToStaticMarkup(React.createElement(MarkdownBody, { content: "See [GEX](/learn/what-is-gex) here." }));
  assert.ok(!html.includes("<figure"), "inline link is not a figure");
  assert.ok(html.includes("what-is-gex"));
});
