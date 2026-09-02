import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REDESIGN = readFileSync(join(__dirname, "RedesignHome.tsx"), "utf8");
const PROMO = readFileSync(join(__dirname, "HomeGammaPromo.tsx"), "utf8");
const FX = readFileSync(join(__dirname, "LandingRedesignFx.tsx"), "utf8");
const CSS = readFileSync(join(__dirname, "..", "..", "app", "marketing-redesign.css"), "utf8");

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
