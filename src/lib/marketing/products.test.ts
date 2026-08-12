import { test } from "node:test";
import assert from "node:assert/strict";
import { MARKETING_PRODUCTS, marketingProductById, marketingProductLearnHref } from "./products";

test("MARKETING_PRODUCTS lists six desk modules", () => {
  assert.equal(MARKETING_PRODUCTS.length, 6);
  const ids = MARKETING_PRODUCTS.map((p) => p.id);
  assert.deepEqual(ids, ["spx", "helix", "thermal", "largo", "hawk", "vector"]);
});

test("every module card links to a public learn guide", () => {
  for (const p of MARKETING_PRODUCTS) {
    assert.match(p.learnHref, /^\/learn\/[a-z0-9-]+$/);
  }
});

test("marketingProductById resolves routes", () => {
  assert.equal(marketingProductById("spx")?.href, "/dashboard");
  assert.equal(marketingProductById("vector")?.launchStatus, "live");
  assert.equal(marketingProductById("vector")?.href, "/vector");
});

test("marketingProductLearnHref resolves learn guides", () => {
  assert.equal(marketingProductLearnHref("helix"), "/learn/helix-flow-scanner-guide");
  assert.equal(marketingProductLearnHref("unknown" as "spx"), "/learn");
});
