import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The premium-exclusive data routes: every product whose PAGE calls requireTier("premium")
// (HELIX flows, BlackOut Thermal heatmap, the whole Vector suite, the premium briefs). The API is
// the ONLY tier-enforcement point for these — middleware matches page paths, not /api/market/* — so
// each MUST gate on the premium helper. A community member hitting these directly was the CWE-863
// paywall bypass this test locks closed.
const PREMIUM_ROUTES = [
  "src/app/api/brief/premarket/route.ts",
  "src/app/api/platform/intel/route.ts",
  "src/app/api/market/flows/route.ts",
  "src/app/api/market/flows/stream/route.ts",
  "src/app/api/market/heatmap/route.ts",
  "src/app/api/market/vector/4h-bars/route.ts",
  "src/app/api/market/vector/bars/route.ts",
  "src/app/api/market/vector/daily-bars/route.ts",
  "src/app/api/market/vector/expected-move/route.ts",
  "src/app/api/market/vector/flow/route.ts",
  "src/app/api/market/vector/gex-heatmap/route.ts",
  "src/app/api/market/vector/gex-ladder/route.ts",
  "src/app/api/market/vector/max-pain/route.ts",
  "src/app/api/market/vector/pin-forecast/route.ts",
  "src/app/api/market/vector/prior-day/route.ts",
  "src/app/api/market/vector/spy-volume/route.ts",
  "src/app/api/market/vector/stream/route.ts",
  "src/app/api/market/vector/universe/route.ts",
  "src/app/api/market/vector/wall-history/route.ts",
  "src/app/api/market/vector/walls/route.ts",
];

// Routes that legitimately back the COMMUNITY SPX Slayer dashboard (requireTier("community")). They
// must KEEP the community gate — the fix must not over-tighten and lock $49 members out of what they
// paid for. Premium members pass the community check too, so premium desks reusing these is fine.
const COMMUNITY_ROUTES = [
  "src/app/api/market/spx/desk/route.ts",
  "src/app/api/market/quote/route.ts",
  "src/app/api/market/indices/route.ts",
  "src/app/api/market/gex-heatmap/route.ts",
];

test("every premium data route gates on authorizePremiumDeskApi, not the community helper", () => {
  for (const path of PREMIUM_ROUTES) {
    const src = readFileSync(path, "utf8");
    assert.match(src, /authorizePremiumDeskApi\(/, `${path} must gate on authorizePremiumDeskApi`);
    // The exact regression: the community helper being called here IS the bypass. Match the CALL,
    // not a mention — a doc comment referencing the old name is allowed, invoking it is not.
    assert.doesNotMatch(src, /authorizeMarketDeskApi\(/, `${path} must NOT call the community gate`);
  }
});

test("community dashboard routes keep the community gate (no over-tightening)", () => {
  for (const path of COMMUNITY_ROUTES) {
    const src = readFileSync(path, "utf8");
    assert.match(src, /authorizeMarketDeskApi\(/, `${path} must stay on the community gate`);
    assert.doesNotMatch(src, /authorizePremiumDeskApi\(/, `${path} must not be forced to premium`);
  }
});

test("the two helpers delegate to the tiers they claim", () => {
  const src = readFileSync("src/lib/market-api-auth.ts", "utf8");
  // authorizePremiumDeskApi → premium; authorizeMarketDeskApi → community. Pin the bodies so nobody
  // "simplifies" one into the other and silently re-opens or over-closes the gate.
  assert.match(
    src,
    /authorizePremiumDeskApi[\s\S]*?authorizeCronOrTierApi\(req, "premium"\)/,
    "authorizePremiumDeskApi must require premium",
  );
  assert.match(
    src,
    /authorizeMarketDeskApi[\s\S]*?authorizeCronOrTierApi\(req, "community"\)/,
    "authorizeMarketDeskApi must require community",
  );
});
