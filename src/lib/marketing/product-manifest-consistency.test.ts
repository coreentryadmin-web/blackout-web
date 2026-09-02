import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BANNED_PUBLIC_MARKETING_PHRASES,
  MANIFEST_PRODUCT_ORDER,
  PRODUCT_MANIFEST,
  manifestProductCount,
  manifestPremiumIncludes,
} from "./product-manifest.ts";
import { MARKETING_PRODUCTS } from "./products.ts";

const REPO = join(import.meta.dirname, "..", "..", "..");

const PUBLIC_SURFACES = [
  "src/lib/faq/content.ts",
  "src/lib/plan-matrix.ts",
  "src/lib/onboarding-content.ts",
  "src/lib/marketing/products.ts",
  "src/lib/site.ts",
  "src/lib/upsell-features.ts",
  "src/components/landing/RedesignHome.tsx",
  "src/components/upgrade/UpgradePageShell.tsx",
  "src/app/(marketing)/vs/others/page.tsx",
  "src/components/seo/JsonLd.tsx",
] as const;

test("manifest defines seven live products including Meridian and Vector", () => {
  assert.equal(manifestProductCount(), 7);
  assert.equal(PRODUCT_MANIFEST.vector.launchStatus, "live");
  assert.equal(PRODUCT_MANIFEST.meridian.launchStatus, "live");
});

// Regression for a P2/P3 finding (2026-09-02): Meridian's "Read the guide" and "Open Meridian"
// buttons both pointed at /meridian (learnHref === href), so "Read the guide" was a dead-end
// duplicate rather than real documentation — the only product on the homepage without one. The
// fix ships a real Meridian Academy guide at /learn/meridian-earnings-desk-guide and re-points
// learnHref at it, which also un-hides the CTA via RedesignHome's existing
// `m.learnHref !== m.href` gate.
test("Meridian has a real, distinct Academy guide (not a duplicate of the product route)", () => {
  const meridian = PRODUCT_MANIFEST.meridian;
  assert.notEqual(meridian.learnHref, meridian.href);
  assert.equal(meridian.learnHref, "/learn/meridian-earnings-desk-guide");
});

test("Night Hawk manifest positions 0DTE Command first, not swing-only", () => {
  const hawk = PRODUCT_MANIFEST.hawk;
  assert.match(hawk.positioning, /0DTE Command/i);
  assert.match(hawk.lifecycle, /0DTE Command/i);
  assert.doesNotMatch(hawk.positioning, /swing playbook/i);
  assert.doesNotMatch(hawk.faqAnswer, /swing and leap/i);
});

test("Vector manifest describes live universe screener capabilities", () => {
  const vector = PRODUCT_MANIFEST.vector;
  assert.equal(vector.launchStatus, "live");
  assert.match(vector.lifecycle, /universe screener/i);
  assert.match(vector.capabilities.join(" "), /wall integrity/i);
});

test("marketing products derive from manifest without Soon status on Vector", () => {
  const vector = MARKETING_PRODUCTS.find((p) => p.id === "vector");
  assert.ok(vector);
  assert.equal(vector!.launchStatus, "live");
  assert.equal(vector!.stat.v, "universe scan");
});

test("premium includes lists every live product label from manifest", () => {
  const perks = manifestPremiumIncludes();
  assert.equal(perks.length, 7);
  for (const id of MANIFEST_PRODUCT_ORDER) {
    assert.ok(perks.includes(PRODUCT_MANIFEST[id].label));
  }
});

test("public marketing surfaces do not contain banned absolute/stale phrases", () => {
  const combined = PUBLIC_SURFACES.map((rel) => readFileSync(join(REPO, rel), "utf8")).join("\n");
  const lower = combined.toLowerCase();
  for (const phrase of BANNED_PUBLIC_MARKETING_PHRASES) {
    assert.doesNotMatch(
      lower,
      new RegExp(phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `banned phrase "${phrase}" found on a public marketing surface`
    );
  }
});

test("FAQ Night Hawk answer matches manifest lifecycle", () => {
  const faq = readFileSync(join(REPO, "src/lib/faq/content.ts"), "utf8");
  assert.match(faq, /0DTE Command/i);
  assert.doesNotMatch(faq, /overnight playbook/i);
});

test("plan matrix Night Hawk line matches manifest planInclude", () => {
  const plan = readFileSync(join(REPO, "src/lib/plan-matrix.ts"), "utf8");
  assert.match(plan, /PRODUCT_MANIFEST\.hawk\.planInclude/);
});
