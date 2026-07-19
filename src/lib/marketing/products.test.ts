import { test } from "node:test";
import assert from "node:assert/strict";
import { MARKETING_PRODUCTS, marketingProductById } from "./products";

test("MARKETING_PRODUCTS lists six desk modules", () => {
  assert.equal(MARKETING_PRODUCTS.length, 6);
  const ids = MARKETING_PRODUCTS.map((p) => p.id);
  assert.deepEqual(ids, ["spx", "helix", "thermal", "largo", "hawk", "vector"]);
});

test("marketingProductById resolves routes", () => {
  assert.equal(marketingProductById("spx")?.href, "/dashboard");
  assert.equal(marketingProductById("vector")?.launchStatus, "soon");
  assert.equal(marketingProductById("vector")?.href, "/pricing");
});
