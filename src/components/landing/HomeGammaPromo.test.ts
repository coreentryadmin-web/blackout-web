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

test("HomeGammaPromo fmtAgeFromAsof uses ageSecFromIso future guard (source scan)", () => {
  const src = readFileSync(join(root, "src/components/landing/HomeGammaPromo.tsx"), "utf8");
  assert.match(src, /import \{ ageSecFromIso \} from "@\/lib\/ws\/timestamp-freshness"/);
  assert.match(
    src,
    /function fmtAgeFromAsof[\s\S]*?ageSecFromIso\(asof\)[\s\S]*?if \(ageSec == null\) return "warming"/,
    "future/skewed asof must not read as live"
  );
});
