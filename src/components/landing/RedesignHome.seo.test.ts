import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REDESIGN = readFileSync(join(__dirname, "RedesignHome.tsx"), "utf8");
const PRICING = readFileSync(join(__dirname, "RedesignPricing.tsx"), "utf8");
const PROMO = readFileSync(join(__dirname, "HomeGammaPromo.tsx"), "utf8");
const FX = readFileSync(join(__dirname, "LandingRedesignFx.tsx"), "utf8");
const CSS = readFileSync(join(__dirname, "..", "..", "app", "marketing-redesign.css"), "utf8");

// Regression for a P2 finding (2026-09-02): the homepage's headline correctly says "Seven
// products" (post the 6->7 catalog migration) but the surrounding eyebrow/subhead/pricing copy
// still said "module" — leftover terminology from before the rename, inconsistent with the FAQ
// and headline, which already say "product". User-visible text only; the `#modules` anchor,
// `sec-cmd`/`cmd-*` CSS classes, and MARKETING_MODULE_GALLERY/marketingModulesHeadline
// identifiers are a URL/code contract, not copy, and are deliberately left untouched.
test("RedesignHome + RedesignPricing user-visible copy says 'product', not the retired 'module'", () => {
  const visibleCopyPatterns = [
    /Every product, in depth/,
    /Each product is a full desk/,
    /Every product — one membership/,
    /Browse products<\/MarketingHashLink>/,
  ];
  for (const p of visibleCopyPatterns) assert.match(REDESIGN, p);
  assert.match(PRICING, /Every product · one membership/);

  // No stray "module" text should remain in a JSX text position (children between > and <).
  // This is deliberately narrow — it must NOT flag the #modules anchor, sec-cmd/cmd-* CSS
  // classes, or MARKETING_MODULE_GALLERY/marketingModulesHeadline identifiers, which are a
  // URL/code contract, not copy.
  assert.doesNotMatch(REDESIGN, />[^<]*\bmodule\b[^<]*</i, "no visible 'module' text should remain on the homepage");
  assert.doesNotMatch(PRICING, />[^<]*\bmodule\b[^<]*</i, "no visible 'module' text should remain on /pricing");
});

// Regression for a P2 finding (2026-09-02): the mobile sticky CTA said "Get access — From
// $199/mo", but $199/mo is the FULL DESK premium price, not a floor — SPX Slayer is a genuinely
// cheaper $49/mo tier shown elsewhere on the same page. "From $X" is a floor claim; asserting it
// against the higher tier's price contradicts the page's own pricing section. This CTA routes to
// /upgrade (the premium checkout flow), so the fix relabels it to match what it actually sells
// instead of changing which price it shows.
test("RedesignHome mobile sticky CTA is honestly labeled Full Desk at the premium price, not a false 'From' floor", () => {
  assert.match(REDESIGN, /signedOutLabel="Get Full Desk"/);
  assert.doesNotMatch(
    REDESIGN,
    /From \{usd\(MEMBERSHIP_PRICING\.monthly\)\}/,
    "must not claim the premium price as a site-wide floor when a cheaper SPX Slayer tier exists"
  );
  assert.match(REDESIGN, /\{usd\(MEMBERSHIP_PRICING\.monthly\)\}\/mo/);
});

test("RedesignHome wires HomeGammaPromo with live initial snapshot", () => {
  assert.match(REDESIGN, /HomeGammaPromo initial=\{initialGamma\}/);
  assert.match(REDESIGN, /HomeGammaHeroLink/);
});

test("RedesignHome hero and modules link to free gamma + learn guides", () => {
  assert.match(REDESIGN, /href="\/tools\/gamma-snapshot"/);
  assert.match(REDESIGN, /hero-cred-link/);
  assert.match(REDESIGN, /m\.learnHref/);
  assert.match(REDESIGN, /Read the guide/);
});

// Regression for a P2 finding (2026-09-02): the comparison table claimed "N products, one
// screen, one membership" — but the seven products are seven distinct routes/surfaces, not one
// unified screen. "One platform" is the claim the product can actually back up.
//
// Corrected AGAIN the same day (second user report): "one platform, one membership" was itself
// still an overclaim — the pricing section on this same page immediately offers a separate $49
// SPX Slayer membership alongside the $199 Full Desk membership, so "one membership" is false as
// a platform-wide claim (it's true only of the Full Desk plan specifically, which is what
// RedesignPricing.tsx's "Every product · one membership" line correctly scopes to — that one was
// left unchanged). The comparison bullet now claims what's actually true of every product:
// they're unified under one Full Desk plan, without asserting there is only one membership tier.
test("RedesignHome comparison list does not overclaim a single unified screen or a single membership tier", () => {
  assert.doesNotMatch(REDESIGN, /one screen/i);
  assert.doesNotMatch(
    REDESIGN,
    /products, one platform, one membership/i,
    "must not claim a single membership tier platform-wide when a cheaper SPX Slayer tier exists"
  );
  assert.match(REDESIGN, /products, one unified Full Desk/);
});

// Regression for a P3 finding (2026-09-02): "No add-ons, no upsells: the whole desk is one
// price" read as claiming a single price point site-wide, contradicting the two-tier pricing
// section (SPX Slayer $49/mo, Full Desk $199/mo) on the same page. The corrected claim scopes to
// what's actually true: Full Desk bundles every product with no per-product add-on pricing.
test("RedesignHome does not claim a single site-wide price when two membership tiers exist", () => {
  assert.doesNotMatch(REDESIGN, /whole desk is one price/i);
  assert.match(REDESIGN, /Full Desk includes every product — no per-product add-ons/);
});

// Regression for a P2 finding (2026-09-02): Meridian's product-manifest entry has
// `learnHref === href === "/meridian"` (no dedicated Academy guide exists yet), so the
// unconditional "Read the guide" CTA sent visitors to the exact same product-shell route as
// "Open Meridian" — two differently-labeled actions to one destination, with the "guide" label
// promising educational content the click never delivers. Every other product's `learnHref`
// points at a distinct `/learn/...` article. The fix hides "Read the guide" whenever a product
// has no guide of its own yet, rather than rendering a dead-end duplicate.
test("RedesignHome module cards hide the guide CTA when a product has no distinct guide yet", () => {
  assert.match(REDESIGN, /m\.learnHref\s*!==\s*m\.href/, "must gate the 'Read the guide' link on a distinct guideHref");
});

test("HomeGammaPromo links to the free gamma snapshot tool", () => {
  assert.match(PROMO, /href="\/tools\/gamma-snapshot"/);
  assert.match(PROMO, /Free gamma snapshot/);
  assert.match(PROMO, /gamma-promo-shell/);
  assert.match(PROMO, /gamma-academy-teaser/);
});

test("pipeline .pipe-status label has exactly one text source, not two overlapping renders", () => {
  // Regression guard for the "How BlackOut Thinks" 01-04 stage badges rendering as garbled
  // double-exposed text (e.g. "ONLINE" overlapping itself) on every homepage visit. Originally
  // the label text was authored twice — once by LandingRedesignFx.tsx's IntersectionObserver
  // rewriting .pipe-status's innerHTML to "<dot/>ONLINE" on scroll-into-view, and once
  // (accidentally) by a CSS `.pipe-status::after{content:"ONLINE"}` that, lacking top/left,
  // rendered at its in-flow "static position" (CSS2.1 10.3.7) directly on top of the JS-authored
  // text. Fixed properly since (2026-09) by removing the runtime text mutation entirely — the
  // stage badges now bake a single static, semantic label (SCAN / VERIFY / STRUCTURE / LOGGED)
  // straight into the server-rendered markup, so there is only ever ONE place the text is
  // authored. LandingRedesignFx only ever toggles a `.is-live` CLASS on scroll for the purely
  // decorative glow — it must never rewrite the badge's innerHTML to a second label.
  assert.match(
    FX,
    /statusEl\.classList\.add\("is-live"\)/,
    "LandingRedesignFx.tsx must light stages via class only, not rewrite label text",
  );
  assert.doesNotMatch(
    FX,
    /pipe-status[\s\S]{0,120}innerHTML/,
    "LandingRedesignFx.tsx should not mutate .pipe-status text at runtime — the badge is static now",
  );
  assert.doesNotMatch(
    CSS,
    /\.pipe-status::after\s*\{[^}]*content:\s*["'][^"']*(ACTIVE|ONLINE|OFFLINE|STANDBY|LIVE)/i,
    "marketing-redesign.css must not add a ::after{content:...} on .pipe-status — " +
      "it would double-render on top of the static server-rendered label",
  );
  assert.match(REDESIGN, /SCAN/, "Identify stage uses semantic SCAN label");
  assert.match(REDESIGN, /VERIFY/, "Validate stage uses semantic VERIFY label");
  assert.doesNotMatch(REDESIGN, />OFFLINE</, "pipeline must never seed OFFLINE on the public homepage");
});
