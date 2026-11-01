import test from "node:test";
import assert from "node:assert/strict";

import { purchaseFiredKey, shouldFirePurchaseConversion } from "./purchase-tracking.ts";

// Regression (2026-11-01): Ga4ConversionTracker's old gate was
//   const nowPaid = tierAtLeast(current, "community");
//   const wasPaid = previous ? tierAtLeast(previous, "community") : false;
//   if (!nowPaid || wasPaid) return;
// i.e. "fire only if paid now AND was not ALREADY on some paid tier before". A member already on
// `community` satisfies `tierAtLeast(previous, "community")`, so `wasPaid` was already true the
// moment they upgraded to `premium` — a real, paid community -> premium upgrade (the $1,999/yr
// case `purchaseTransactionId`'s own doc comment names explicitly) silently never fired ANY
// purchase conversion. The fix compares tier RANK instead of "was any paid tier".

test("shouldFirePurchaseConversion: free -> community fires (first paid tier)", () => {
  assert.equal(shouldFirePurchaseConversion("community", "free"), true);
});

test("shouldFirePurchaseConversion: free -> premium fires (first paid tier, skips community)", () => {
  assert.equal(shouldFirePurchaseConversion("premium", "free"), true);
});

test("shouldFirePurchaseConversion: THE BUG — community -> premium must fire (a real upgrade)", () => {
  // This is exactly the case the old `wasPaid` gate swallowed: `previous` ("community") was
  // already a paid tier, so the old code returned early and never reached the purchase-tracking
  // calls at all, regardless of how `purchaseTransactionId` was keyed downstream.
  assert.equal(shouldFirePurchaseConversion("premium", "community"), true);
});

test("shouldFirePurchaseConversion: no tier change does not re-fire", () => {
  assert.equal(shouldFirePurchaseConversion("premium", "premium"), false);
  assert.equal(shouldFirePurchaseConversion("community", "community"), false);
});

test("shouldFirePurchaseConversion: a downgrade never fires (not a purchase)", () => {
  assert.equal(shouldFirePurchaseConversion("community", "premium"), false);
  assert.equal(shouldFirePurchaseConversion("free", "premium"), false);
});

test("shouldFirePurchaseConversion: still free never fires", () => {
  assert.equal(shouldFirePurchaseConversion("free", "free"), false);
  assert.equal(shouldFirePurchaseConversion("free", null), false);
});

test("shouldFirePurchaseConversion: previous === null (first observed mount) fires for any paid tier", () => {
  assert.equal(shouldFirePurchaseConversion("community", null), true);
  assert.equal(shouldFirePurchaseConversion("premium", null), true);
});

test("purchaseFiredKey: scoped per (user, tier) — not shared across tiers for the same user", () => {
  const communityKey = purchaseFiredKey("user_1", "community");
  const premiumKey = purchaseFiredKey("user_1", "premium");
  assert.notEqual(
    communityKey,
    premiumKey,
    "a flag set for the member's community purchase must not also cover a later premium upgrade"
  );
  assert.equal(communityKey, "user_1:community");
  assert.equal(premiumKey, "user_1:premium");
});
