import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cfPurgeTrustPagesGate,
  mobileStickyFaqOverlapGate,
  gammaLoadingFreshnessConflict,
  homepageH1AboveFold,
  methodologyPageGate,
  scanForbiddenMarketingCopy,
  sitemapMethodologyGate,
  upgradeAnonSyncGate,
  whopScriptPriceParity,
} from "./lib/marketing-funnel-eval.mjs";

test("scanForbiddenMarketingCopy: flags stale Whop/community drift", () => {
  const hits = scanForbiddenMarketingCopy(
    "Does not include SPX Slayer, HELIX, Largo. Community Discord-only ($75/mo)."
  );
  assert.ok(hits.some((h) => h.id === "whop-excludes-spx"));
  assert.ok(hits.some((h) => h.id === "community-75"));
});

test("scanForbiddenMarketingCopy: clean SPX Slayer copy passes", () => {
  const hits = scanForbiddenMarketingCopy(
    "BlackOut SPX Slayer — $49/mo. Live SPX desk, GEX, graded plays. Premium unlocks HELIX."
  );
  assert.equal(hits.length, 0);
});

test("whopScriptPriceParity: requires canonical price mentions", () => {
  const ok = whopScriptPriceParity(
    "SPX Slayer $49/mo. Premium $199/mo. Yearly $1,999. BlackOut SPX Slayer",
    { community: 49, monthly: 199, yearly: 1999 }
  );
  assert.deepEqual(ok, []);
});

test("gammaLoadingFreshnessConflict: detects simultaneous loading + levels", () => {
  assert.equal(gammaLoadingFreshnessConflict("Loading…\nLevels computed 12s ago"), true);
  assert.equal(gammaLoadingFreshnessConflict("Levels computed 12s ago"), false);
});

test("homepageH1AboveFold: rejects hero buried below 420px", () => {
  assert.equal(homepageH1AboveFold(762).ok, false);
  assert.equal(homepageH1AboveFold(180).ok, true);
});

test("upgradeAnonSyncGate: rejects paid sync in anonymous HTML", () => {
  assert.equal(
    upgradeAnonSyncGate('<button>I paid — refresh my access</button>').ok,
    false
  );
  assert.equal(
    upgradeAnonSyncGate('<a href="/sign-in?redirect_url=%2Fupgrade">Sign in to sync purchase</a>').ok,
    true
  );
});

test("methodologyPageGate: requires live trust copy + lane jump-nav", () => {
  const html =
    '<html class="methodology-lane-nav">Grading methodology — never blended' +
    '<a href="#methodology-spx">SPX</a><a href="#methodology-nighthawk">NH</a>' +
    '<a href="#methodology-zerodte">0DTE</a></html>';
  assert.equal(methodologyPageGate(html, 200).ok, true);
  assert.equal(
    methodologyPageGate("<html>Grading methodology — never blended</html>", 200).ok,
    false
  );
  assert.equal(methodologyPageGate("<html>404</html>", 404).ok, false);
});

test("sitemapMethodologyGate: requires methodology + learn URLs", () => {
  const base = "https://blackouttrades.com";
  assert.equal(
    sitemapMethodologyGate(`<urlset><loc>${base}/methodology</loc><loc>${base}/learn</loc></urlset>`, base).ok,
    true
  );
  assert.equal(sitemapMethodologyGate("<urlset><loc>https://blackouttrades.com/</loc></urlset>", base).ok, false);
});

test("cfPurgeTrustPagesGate: requires trust URLs in deploy purge list", () => {
  assert.equal(
    cfPurgeTrustPagesGate('"/methodology", "/sitemap.xml", "/why-blackout"').ok,
    false
  );
  assert.equal(
    cfPurgeTrustPagesGate(
      '"/methodology", "/why-blackout", "/vs/others", "/tools/gamma-snapshot", "/sitemap.xml"'
    ).ok,
    true
  );
});

test("mobileStickyFaqOverlapGate: requires overlap suppression in LandingRedesignFx", () => {
  const ok =
    'import { mobileStickyBlockedByContent, shouldShowMobileStickyCta } from "@/lib/marketing/mobile-sticky-cta";\n' +
    'document.querySelectorAll(".faq-item").forEach((el) => el.addEventListener("toggle", refreshMobileStickyCta));';
  assert.equal(mobileStickyFaqOverlapGate(ok).ok, true);
  assert.equal(mobileStickyFaqOverlapGate("// missing guard").ok, false);
});
