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

test("HomeGammaPromo links to the free gamma snapshot tool", () => {
  assert.match(PROMO, /href="\/tools\/gamma-snapshot"/);
  assert.match(PROMO, /Free gamma snapshot/);
  assert.match(PROMO, /gamma-promo-shell/);
  assert.match(PROMO, /gamma-academy-teaser/);
});

test("pipeline .pipe-status label has exactly one text source, not two overlapping renders", () => {
  // Regression guard for the "How BlackOut Thinks" 01-04 stage badges rendering as
  // garbled double-exposed text (e.g. "ONLINE" overlapping itself) on every homepage visit.
  // Originally the label text was authored twice — once by LandingRedesignFx.tsx's
  // IntersectionObserver rewriting .pipe-status's innerHTML to "<dot/>ONLINE" on scroll-into-
  // view, and once (accidentally) by a CSS `.pipe-status::after{content:"ONLINE"}` that,
  // lacking top/left, rendered at its in-flow "static position" (CSS2.1 10.3.7) directly on
  // top of the JS-authored text. Fixed properly since (2026-09) by removing the runtime text
  // mutation entirely — RedesignHome.tsx now bakes a single static "LIVE" label straight into
  // the server-rendered markup, so there is only ever ONE place the text is authored, and no
  // scroll-triggered rewrite can ever race a CSS pseudo-element again.
  assert.doesNotMatch(
    FX,
    /pipe-status[\s\S]{0,120}innerHTML/,
    "LandingRedesignFx.tsx should not mutate .pipe-status text at runtime — the badge is static now",
  );
  assert.doesNotMatch(
    CSS,
    /\.pipe-status::after\s*\{[^}]*content:\s*["'][^"']*(ONLINE|OFFLINE|LIVE)/i,
    "marketing-redesign.css must not add a ::after{content:...} on .pipe-status — " +
      "it would double-render on top of the static server-rendered label",
  );
});
