import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
(globalThis as unknown as { React: typeof React }).React = React;

// ProductMark's geometry (geometry.tsx) paints every sigil's focal/bloom group via
// filter="url(#bo-glow)" and fills via url(#bo-accent-radial)/url(#bo-accent-linear)/etc.,
// referencing <defs> that live once in <SharedSigilDefs/>. Those ids must exist SOMEWHERE
// in the DOM on any page that renders a <ProductMark> — otherwise the url() references
// resolve to nothing and the SVG filter/paint spec requires the referencing element not be
// painted at all, not just lose its glow.
test("MarketingPageShell mounts SharedSigilDefs so ProductMark's url(#...) references resolve", async () => {
  const { MarketingPageShell } = await import("./MarketingPageShell");
  const { ProductMark } = await import("@/components/marks/ProductMark");

  const html = renderToStaticMarkup(
    React.createElement(MarketingPageShell, {
      children: React.createElement(ProductMark, { product: "vector" }),
    })
  );

  assert.match(html, /url\(#bo-glow\)/, "fixture must actually reference #bo-glow (else this test is vacuous)");
  assert.match(html, /id="bo-glow"/, "SharedSigilDefs' #bo-glow filter must be present in the same page");
  assert.match(html, /id="bo-accent-radial"/);
  assert.match(html, /id="bo-accent-linear"/);
});
