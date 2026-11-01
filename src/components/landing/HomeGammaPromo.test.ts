import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

test("HomeGammaPromo never shows the frozen seed's literal text while its mount-fetch is in flight", () => {
  const src = readFileSync(join(root, "src/components/landing/HomeGammaPromo.tsx"), "utf8");
  assert.match(
    src,
    /useState\(\(\) => !hasLevels\(initial\)\)/,
    "loading must be seeded synchronously from whether the SSR seed already has levels, so the " +
      "very first paint never shows a frozen `initial.read` string while a corrective fetch is " +
      "about to run"
  );
  assert.match(
    src,
    /\{!showLevels[\s\S]{0,40}\?[\s\S]{0,200}loading\s*\?\s*"Loading live gamma levels…"\s*:\s*snapshot\.read/,
    "the not-available branch must gate on `loading` before ever rendering the raw seed text"
  );
});

// Regression for a real production CLS incident (2026-09-18, homepage, desktop, post-edge-purge):
// this page is ISR (`revalidate=3600`, src/app/(marketing)/page.tsx) seeded from a cache-only
// read that can legitimately lack live levels, so `showLevels` starts false and the mount-fetch
// above (documented as deliberate) flips it to true a moment later — swapping the compact
// `.gamma-promo-warm` placeholder for the full headline/matrix/read block below it. Caught live:
// the CTA link's own rect moved ~105-140px in one real, catchable layout-shift event (CLS 0.132,
// over the 0.1 threshold). `.gamma-promo-warm` must reserve roughly the loaded state's height so
// that transition doesn't visibly collapse-then-expand the panel.
test("gamma-promo-warm reserves space for the loaded state (CLS)", () => {
  const css = readFileSync(join(root, "src/app/marketing-redesign.css"), "utf8");
  assert.match(
    css,
    /\.rl \.gamma-promo-warm\{[^}]*min-height:14rem[^}]*\}/,
    "the warm placeholder must reserve height so the mount-fetch self-heal (loading -> loaded) " +
      "doesn't cause a real layout shift when it swaps in the full matrix/read content"
  );
});

test("HomeGammaPromo fmtAgeFromAsof uses ageSecFromIso future guard (source scan)", () => {
  const src = readFileSync(join(root, "src/components/landing/HomeGammaPromo.tsx"), "utf8");
  assert.match(src, /import \{ ageSecFromIso \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(
    src,
    /function fmtAgeFromAsof[\s\S]*?ageSecFromIso\(asof\)[\s\S]*?if \(ageSec == null\) return "warming"/,
    "future/skewed asof must not read as live"
  );
});
