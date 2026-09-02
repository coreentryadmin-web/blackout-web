import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

// 2026-09-02, P1 (user report): production kept showing "Snapshot warming up — check back
// shortly" directly beside a "Live" pill and "Refreshes live every 5 seconds" copy. A live
// browser check through the CONNECT-tunnel proxy proved the underlying data path is healthy and
// the component DOES self-heal — but only ~1-8s after mount, because the homepage is
// `revalidate=3600` ISR AND Cloudflare-edge-cached for up to 7200s for anonymous visitors
// (HomeLiveDeskStrip.tsx's own fix note), so whatever `initial.read` said at the moment that
// cached HTML was generated gets displayed as fact on every subsequent page load until the
// mount-fetch corrects it. The component rendered that frozen, possibly-false seed text
// unconditionally in the `!showLevels` branch, with no distinction between "genuinely
// unavailable" and "a corrective fetch is already in flight" — this is the bug the user's report
// reproduced, not a backend outage. Source-text assertions (this file's existing sibling
// convention — no React Testing Library in this repo).
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
