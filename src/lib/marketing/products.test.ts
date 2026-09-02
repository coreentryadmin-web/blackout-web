import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MARKETING_PRODUCTS,
  marketingModulesHeadline,
  marketingProductCount,
  premiumPricingPerks,
} from "./products.ts";

test("marketing product count is driven from the registry, not hardcoded", () => {
  assert.equal(marketingProductCount(), MARKETING_PRODUCTS.filter((p) => p.launchStatus === "live").length);
  assert.equal(marketingProductCount(), 7);
});

test("premium pricing perks lists every live product by name", () => {
  const perks = premiumPricingPerks();
  assert.equal(perks.length, 7);
  assert.ok(perks.includes("Meridian"));
  assert.ok(perks.includes("Night Hawk"));
  assert.ok(perks.includes("Vector"));
});

test("modules headline pluralizes from the live registry count", () => {
  assert.equal(marketingModulesHeadline(), "Seven products.");
});

test("Night Hawk marketing copy reflects intraday 0DTE command, not swing-only positioning", () => {
  const hawk = MARKETING_PRODUCTS.find((p) => p.id === "hawk");
  assert.ok(hawk);
  assert.match(hawk!.tag, /0DTE/i);
  assert.doesNotMatch(hawk!.lede, /swing playbook/i);
  assert.match(hawk!.bullets.join(" "), /0DTE Command/i);
});

test("Vector is live in the marketing registry", () => {
  const vector = MARKETING_PRODUCTS.find((p) => p.id === "vector");
  assert.ok(vector);
  assert.equal(vector!.launchStatus, "live");
  assert.equal(vector!.stat.v, "universe scan");
});
