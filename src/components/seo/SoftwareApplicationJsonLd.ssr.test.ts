import { test } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Regression guard: SoftwareApplicationJsonLd's Offer entries had name/price/priceCurrency/url
// but no `availability`, which Google's Offer/Merchant guidance expects for rich-result and
// price-related eligibility. A membership offer is always purchasable (no physical stock), so
// "InStock" is evergreen and safe to hardcode — unlike priceValidUntil, which would need a real
// expiration date and risks becoming a stale-data bug if left unmaintained (deliberately not
// added here for that reason).

(globalThis as unknown as { React: typeof React }).React = React;

async function renderSoftwareApplicationJsonLd(): Promise<Record<string, unknown>> {
  const { SoftwareApplicationJsonLd } = await import("./JsonLd");
  const html = renderToStaticMarkup(React.createElement(SoftwareApplicationJsonLd));
  const match = html.match(/<script type="application\/ld\+json">(.*)<\/script>/);
  assert.ok(match, "expected a JSON-LD script tag in the rendered markup");
  return JSON.parse(match[1]);
}

test("SoftwareApplicationJsonLd Offers declare InStock availability", async () => {
  const data = await renderSoftwareApplicationJsonLd();
  const offers = data.offers as { name: string; availability?: string }[];
  assert.equal(offers.length, 2);
  for (const offer of offers) {
    assert.equal(offer.availability, "https://schema.org/InStock", `${offer.name} offer should declare InStock availability`);
  }
});
