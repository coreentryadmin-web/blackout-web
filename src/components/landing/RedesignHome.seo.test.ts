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
  // garbled double-exposed text (e.g. "ONLINE" overlapping itself) on every homepage
  // visit. Root cause: LandingRedesignFx.tsx's IntersectionObserver already rewrites
  // .pipe-status's innerHTML to "<dot/>ONLINE" the instant a stage scrolls into view —
  // that must stay the ONE place the label text is authored. A CSS
  // `.pipe-status::after{content:"ONLINE"}` used to duplicate it: with no top/left set,
  // an absolutely-positioned ::after renders at its in-flow "static position" (CSS2.1
  // 10.3.7), landing directly on top of the JS-authored text instead of away from it.
  // RedesignHome.tsx seeds the same nodes with static "OFFLINE" markup pre-hydration,
  // which is expected (and is never lit at first paint) — only guard the CSS/JS pair
  // that actually fires once a stage goes live.
  assert.match(
    FX,
    /statusEl\.innerHTML = .*ONLINE/,
    "LandingRedesignFx.tsx must still author the lit .pipe-status label text",
  );
  assert.doesNotMatch(
    CSS,
    /\.pipe-status::after\s*\{[^}]*content:\s*["'][^"']*(ONLINE|OFFLINE)/i,
    "marketing-redesign.css must not re-add a ::after{content:\"ONLINE\"} on .pipe-status — " +
      "it double-renders on top of the JS-authored label (see the comment above pipe-status in that file)",
  );
});
