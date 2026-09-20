/**
 * Regression test for the false-collision bug reproduced live on prod `/heatmap` at 430px
 * (2026-09-20): a `width: 0; overflow: hidden` nav-brand collapse (the real, shipped
 * `nav-brand-ios-compact` pattern in src/components/Nav.tsx + globals.css) was reported as
 * colliding with the ☰ menu button it is in fact invisible behind.
 *
 * Root cause (two compounding bugs in the same file):
 *   1. `visibleFraction` treated a ZERO-SIZE `overflow: hidden` clipping ancestor as imposing NO
 *      constraint (`continue`), when a zero-size clip is the STRONGEST constraint there is. The
 *      collapsed child kept its own unclipped rect (getBoundingClientRect always reports where
 *      content WOULD be) and scored 1.0 "fully visible".
 *   2. `vis()` read only the node's own `opacity`/`visibility`/`display`, never an ancestor's — so
 *      a child of an `opacity: 0` parent (opacity does not inherit as a computed value) still
 *      passed as visible.
 *
 * Both predicates independently let the invisible wordmark span into the collision check, which
 * then genuinely intersects the ☰ button's rect (by construction of this fixture, matching the
 * real page's real coordinates) and gets reported as a defect that does not exist for any member.
 *
 * This fixture never touches the network — `page.setContent` mirrors the real
 * `nav-brand-ios-compact` CSS byte-for-byte (see globals.css) so it can't silently drift from the
 * pattern it exists to guard.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { createRequire } from "node:module";
import { probeGeometry } from "./ui-geometry-probe.mjs";

const require_ = createRequire(import.meta.url);
const { chromium } = require_("playwright");
const { resolveChromiumPath } = require_("./playwright-chromium-path.cjs");

// Mirrors the real shipped rule (globals.css `.nav-bar-ios-tool .nav-brand-ios-compact`) and the
// real measured coordinates from prod: wordmark x 233..305, ☰ button x 225..269, both inside one
// `position: fixed` nav bar (the layering the probe uses to decide "peers fighting for the same
// pixels" vs. "an intentional overlay").
const FIXTURE_HTML = `<!doctype html>
<html><head><style>
  body { margin: 0; }
  .nav-bar { position: fixed; top: 0; left: 0; right: 0; height: 60px; }
  .nav-brand-ios-compact {
    opacity: 0; width: 0; min-width: 0; overflow: hidden;
    position: absolute; left: 233px; top: 20px;
  }
  .nav-wordmark { font-size: 26px; white-space: nowrap; }
  .menu-btn { position: absolute; left: 225px; top: 8px; width: 44px; height: 44px; }
</style></head>
<body>
  <div class="nav-bar">
    <a class="nav-brand-ios-compact" href="/">
      <span class="nav-wordmark">BLACKOUT</span>
    </a>
    <button class="menu-btn" aria-label="Open menu">☰</button>
  </div>
</body></html>`;

test("a width:0/overflow:hidden collapsed nav brand is not reported as colliding with the menu button", async () => {
  const browser = await chromium.launch({
    executablePath: resolveChromiumPath(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(FIXTURE_HTML);

    // Sanity check the fixture actually reproduces the geometry that fooled the probe live: the
    // collapsed span's OWN rect must still report a nonzero, overlapping-with-the-button box —
    // otherwise this test would pass for the wrong reason (nothing to clip in the first place).
    const rawRects = await page.evaluate(() => {
      const w = document.querySelector(".nav-wordmark").getBoundingClientRect();
      const b = document.querySelector(".menu-btn").getBoundingClientRect();
      return { wordmark: { l: w.left, r: w.right }, button: { l: b.left, r: b.right } };
    });
    assert.ok(
      rawRects.wordmark.l < rawRects.button.r && rawRects.wordmark.r > rawRects.button.l,
      "fixture must reproduce an unclipped-rect overlap for this regression test to mean anything"
    );

    const geo = await probeGeometry(page);
    assert.deepEqual(geo.collide, [], "collapsed nav brand must not read as colliding with the ☰ button");
    assert.deepEqual(geo.clipped, [], "a deliberate width:0 collapse is not a CLIPPED defect either");
  } finally {
    await browser.close();
  }
});

test("a genuinely visible, unclipped label really does still collide with a control it overlaps", async () => {
  // Negative control: the fix must not blind the detector outright. A label with no clipping
  // ancestor, no opacity/visibility trick, and (unlike the fixture above) no wrapping `<a>` of its
  // own — so there is exactly one control in play, the button — positioned over that button must
  // still fire. Otherwise "fix false positives" degenerated into "never report anything".
  const html = FIXTURE_HTML.replace(
    '<a class="nav-brand-ios-compact" href="/">\n      <span class="nav-wordmark">BLACKOUT</span>\n    </a>',
    '<span class="nav-wordmark" style="position:absolute;left:180px;top:8px;">BLACKOUT</span>'
  );
  const browser = await chromium.launch({
    executablePath: resolveChromiumPath(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    const geo = await probeGeometry(page);
    assert.equal(geo.collide.length, 1, "a real, visible overlap on a control must still be reported");
  } finally {
    await browser.close();
  }
});
