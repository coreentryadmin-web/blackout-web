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
  // garbled double-exposed text on every homepage visit. Stage labels are semantic
  // static copy (SCAN / VERIFY / STRUCTURE / LOGGED). LandingRedesignFx only adds
  // `.is-live` on scroll — it must NOT rewrite innerHTML to a second label.
  assert.match(
    FX,
    /statusEl\.classList\.add\("is-live"\)/,
    "LandingRedesignFx.tsx must light stages via class only, not rewrite label text",
  );
  assert.doesNotMatch(
    CSS,
    /\.pipe-status::after\s*\{[^}]*content:\s*["'][^"']*(ACTIVE|ONLINE|OFFLINE|STANDBY)/i,
    "marketing-redesign.css must not add a ::after label on .pipe-status",
  );
  assert.match(REDESIGN, /SCAN/, "Identify stage uses semantic SCAN label");
  assert.match(REDESIGN, /VERIFY/, "Validate stage uses semantic VERIFY label");
  assert.doesNotMatch(REDESIGN, />OFFLINE</, "pipeline must never seed OFFLINE on the public homepage");
});
