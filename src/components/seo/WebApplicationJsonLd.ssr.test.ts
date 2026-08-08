import { test } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Regression guard: /tools/gamma-snapshot (a real, valuable free lead-magnet tool page) only
// emitted generic WebPageJsonLd — no application-specific structured data, unlike the paid
// membership product on /pricing (SoftwareApplicationJsonLd). WebApplicationJsonLd fills that
// gap as its own entity, distinct from the paid-product schema, with a real $0 Offer.

(globalThis as unknown as { React: typeof React }).React = React;

async function renderWebApplicationJsonLd(): Promise<Record<string, unknown>> {
  const { WebApplicationJsonLd } = await import("./JsonLd");
  const html = renderToStaticMarkup(
    React.createElement(WebApplicationJsonLd, {
      name: "Gamma Flip & Wall Levels",
      description: "Free dealer gamma snapshot for SPX, SPY, and QQQ.",
      path: "/tools/gamma-snapshot",
    }),
  );
  const match = html.match(/<script type="application\/ld\+json">(.*)<\/script>/);
  assert.ok(match, "expected a JSON-LD script tag in the rendered markup");
  return JSON.parse(match[1]);
}

test("WebApplicationJsonLd emits a WebApplication entity with a free Offer", async () => {
  const data = await renderWebApplicationJsonLd();
  assert.equal(data["@type"], "WebApplication");
  assert.equal(data.name, "Gamma Flip & Wall Levels");
  assert.equal(data.url, "https://blackouttrades.com/tools/gamma-snapshot");
  const offer = data.offers as { price: string; priceCurrency: string };
  assert.equal(offer.price, "0");
  assert.equal(offer.priceCurrency, "USD");
});
