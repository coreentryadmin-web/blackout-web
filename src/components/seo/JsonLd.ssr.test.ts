import { test } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MEMBERSHIP_PRICING } from "@/lib/pricing";

// Regression guard: SoftwareApplicationJsonLd's Offer prices used to be hand-typed string
// literals ("49" / "199") instead of reading MEMBERSHIP_PRICING, the single source of truth
// every other pricing surface (homepage tiers, /pricing, /upgrade) already reads from. A price
// change would silently drift the structured-data Offer out of sync with what members actually
// see and pay, while Google's cached rich-result data kept showing the stale number.

(globalThis as unknown as { React: typeof React }).React = React;

async function renderSoftwareApplicationJsonLd(): Promise<string> {
  const { SoftwareApplicationJsonLd } = await import("./JsonLd");
  return renderToStaticMarkup(React.createElement(SoftwareApplicationJsonLd));
}

test("SoftwareApplicationJsonLd Offer prices match the canonical MEMBERSHIP_PRICING source of truth", async () => {
  const html = await renderSoftwareApplicationJsonLd();
  const match = html.match(/<script type="application\/ld\+json">(.*)<\/script>/);
  assert.ok(match, "expected a JSON-LD script tag in the rendered markup");

  const data = JSON.parse(match[1]);
  const offers = data.offers as { name: string; price: string }[];

  const spxSlayer = offers.find((o) => o.name === "SPX Slayer");
  const premium = offers.find((o) => o.name === "Premium");

  assert.ok(spxSlayer, "expected an SPX Slayer offer");
  assert.ok(premium, "expected a Premium offer");
  assert.equal(spxSlayer?.price, String(MEMBERSHIP_PRICING.community));
  assert.equal(premium?.price, String(MEMBERSHIP_PRICING.monthly));
});
