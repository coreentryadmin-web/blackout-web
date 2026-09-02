import { test } from "node:test";
import assert from "node:assert/strict";
import { MARKETING_PRODUCTS, capitalizedNumberWord, marketingProductById, marketingProductLearnHref } from "./products";

test("MARKETING_PRODUCTS lists six desk modules", () => {
  assert.equal(MARKETING_PRODUCTS.length, 6);
  const ids = MARKETING_PRODUCTS.map((p) => p.id);
  assert.deepEqual(ids, ["spx", "helix", "thermal", "largo", "hawk", "vector"]);
  // NOTE: the real desk ships SEVEN modules (this list is missing Meridian) — see
  // docs/audit/findings-staging/2026-09-02-homepage-product-copy-manifest-drift.md. Meridian
  // is blocked from joining this carousel until a real /images/marketing/meridian*.webp
  // screenshot exists (MARKETING_MODULE_GALLERY has no entry and none should be fabricated).
  // The homepage headline/cred-count below are already derived from this array's length, so
  // adding Meridian's entry here is the ONLY change needed to correct them platform-wide.
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

test("capitalizedNumberWord matches small counts, falls back to the numeral otherwise", () => {
  assert.equal(capitalizedNumberWord(6), "Six");
  assert.equal(capitalizedNumberWord(7), "Seven");
  assert.equal(capitalizedNumberWord(0), "Zero");
  assert.equal(capitalizedNumberWord(42), "42");
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
