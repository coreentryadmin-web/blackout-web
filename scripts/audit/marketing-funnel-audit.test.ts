import assert from "node:assert/strict";
import { test } from "node:test";
import {
  gammaLoadingFreshnessConflict,
  homepageH1AboveFold,
  methodologyPageGate,
  scanForbiddenMarketingCopy,
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

test("methodologyPageGate: requires live trust copy", () => {
  assert.equal(methodologyPageGate("<html>Grading methodology — never blended</html>", 200).ok, true);
  assert.equal(methodologyPageGate("<html>404</html>", 404).ok, false);
});
