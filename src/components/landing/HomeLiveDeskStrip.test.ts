import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

// 2026-09-02, P1 (user report): the homepage route is `revalidate = 3600` (ISR) AND
// force-cached at the Cloudflare edge for `edge_ttl 7200` for anonymous visitors/crawlers —
// so a single bad SSR moment (a transient upstream stall, e.g. the multi-minute ALB
// tail-latency episodes in FINDINGS 2026-09-02) can bake a "GEX snapshot initializing" seed
// into the cached page for up to ~3 hours. This component used to be a pure server-rendered
// prop with NO client-side hook at all, so nothing ever corrected a bad seed even once a real
// browser loaded the page and ran its JS — unlike its sibling `HomeGammaPromo`, which already
// self-heals via a mount-fetch + 5s poll. Source-text assertions (this file's existing
// convention — no React Testing Library in this repo) rather than a render test.
test("HomeLiveDeskStrip is a client component that self-heals a stale gamma seed on mount", () => {
  const src = readFileSync(join(root, "src/components/landing/HomeLiveDeskStrip.tsx"), "utf8");
  assert.match(src, /^"use client";/, "must be a client component to run a mount-fetch/poll effect");
  assert.match(
    src,
    /fetch\(`\/api\/public\/gex-snapshot\?ticker=\$\{ticker\}`,\s*\{\s*cache:\s*"no-store"\s*\}\)/,
    "must re-fetch the live, never-cached snapshot endpoint client-side"
  );
  assert.match(src, /useEffect/, "must run its refresh in an effect, not only from the initial prop");
  assert.match(
    src,
    /window\.setInterval\(tick,\s*5_000\)/,
    "must poll on the same 5s cadence as the underlying snapshot cache/matrix"
  );
});

test("home live desk strip keeps the page's shared 1.5rem side margin", () => {
  // HomeLiveDeskStrip renders its row as <div className="w home-live-strip-inner">, combining
  // the shared `.w` class (max-width + centering + `padding:0 1.5rem`, used by every other
  // section on the homepage) with its own `.home-live-strip-inner` class. `.rl
  // .home-live-strip-inner` is more specific than `.w`, so its own `padding` shorthand fully
  // overrides all four sides rather than layering on top — a bare `padding:.65rem 0` here
  // silently zeroes the 1.5rem horizontal margin `.w` was added for, making the row (the "GEX
  // snapshot initializing" chip and the product-link ticker beneath it) run edge-to-edge while
  // every sibling section on the page keeps its 1.5rem side padding. Confirmed live on prod
  // mobile (430px viewport): the row's text sits flush at x=0, unlike the rest of the hero.
  const css = readFileSync(join(root, "src/app/marketing-redesign.css"), "utf8");
  const rule = css.match(/\.rl \.home-live-strip-inner\{([^}]*)\}/);
  assert.ok(rule, "expected a .rl .home-live-strip-inner rule in marketing-redesign.css");
  const padding = rule![1].match(/padding:([^;]+);/);
  assert.ok(padding, "expected a padding declaration on .rl .home-live-strip-inner");
  assert.equal(
    padding![1].trim(),
    ".65rem 1.5rem",
    "the horizontal component must restate .w's 1.5rem side padding, not zero it out"
  );
});
