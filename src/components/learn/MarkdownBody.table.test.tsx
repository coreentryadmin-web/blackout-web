import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
(globalThis as unknown as { React: typeof React }).React = React;

test("MarkdownBody renders GFM pipe tables as semantic HTML tables", async () => {
  const { MarkdownBody } = await import("./MarkdownBody.tsx");
  const md = `| State | Window |
| --- | --- |
| **RTH** | 10:00-16:00 |
| CLOSED | After 16:00 |`;

  const html = renderToStaticMarkup(React.createElement(MarkdownBody, { content: md }));
  assert.match(html, /<table/);
  assert.match(html, /<th[^>]*>State<\/th>/);
  assert.match(html, /<td[^>]*><strong>RTH<\/strong><\/td>/);
  assert.doesNotMatch(html, /\| --- \|/);
});
