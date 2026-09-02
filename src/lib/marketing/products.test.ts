import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MARKETING_PRODUCTS,
  marketingModulesHeadline,
  marketingProductById,
  marketingProductCount,
  premiumPricingPerks,
} from "./products.ts";

test("marketing product count is driven from the registry, not hardcoded", () => {
  assert.equal(marketingProductCount(), MARKETING_PRODUCTS.filter((p) => p.launchStatus === "live").length);
  assert.equal(marketingProductCount(), 7);
});

// A launchStatus:"live" module telling the member "Soon"/"Rolling out" contradicts its own
// status field — exactly the Vector bug found 2026-09-02 (launchStatus "live", but its own
// stat/bullets said "Soon · universe scan" / "Rolling out as desk coverage expands" while its
// public guide already documented a mature, shipped feature set).
test("no live module's own copy claims it is still rolling out", () => {
  const notYetLivePattern = /\bsoon\b|rolling out/i;
  for (const p of MARKETING_PRODUCTS.filter((m) => m.launchStatus === "live")) {
    assert.doesNotMatch(p.stat.k, notYetLivePattern, `${p.id} stat.k contradicts launchStatus:"live"`);
    assert.doesNotMatch(p.stat.v, notYetLivePattern, `${p.id} stat.v contradicts launchStatus:"live"`);
    for (const b of p.bullets) {
      assert.doesNotMatch(b, notYetLivePattern, `${p.id} bullet contradicts launchStatus:"live": "${b}"`);
    }
  }
});

// Night Hawk's homepage card must describe BOTH halves of the product (evening playbook AND
// the intraday 0DTE scanner) — the FAQ ("Night Hawk evening + 0DTE Command scanners") and the
// public guide already describe both; the homepage card previously described only the
// overnight/swing half, contradicting the FAQ on the same page.
test("Night Hawk's card mentions 0DTE Command, not just the evening playbook", () => {
  const hawk = marketingProductById("hawk");
  assert.ok(hawk, "MARKETING_PRODUCTS is missing the hawk entry");
  const haystack = [hawk!.tag, hawk!.headline, hawk!.lede, hawk!.heroBlurb, ...hawk!.bullets].join(" ");
  assert.match(haystack, /0DTE Command/i);
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
  assert.match(hawk!.lede, /0DTE Command/i);
  assert.doesNotMatch(hawk!.lede, /swing playbook/i);
  assert.match(hawk!.bullets.join(" "), /0DTE Command/i);
});

test("Vector is live in the marketing registry", () => {
  const vector = MARKETING_PRODUCTS.find((p) => p.id === "vector");
  assert.ok(vector);
  assert.equal(vector!.launchStatus, "live");
  assert.equal(vector!.stat.v, "universe scan");
});
