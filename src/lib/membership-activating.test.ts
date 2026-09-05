import assert from "node:assert/strict";
import test from "node:test";
import {
  isPaidTier,
  shouldPollMembershipActivation,
  tierFromMembershipSyncBody,
} from "./membership-activating.ts";

test("shouldPollMembershipActivation: true when recent checkout plan but tier still free", () => {
  assert.equal(
    shouldPollMembershipActivation({
      isLoaded: true,
      isSignedIn: true,
      tier: "free",
      rememberedPlan: "monthly",
    }),
    true,
  );
});

test("shouldPollMembershipActivation: false when tier already paid", () => {
  assert.equal(
    shouldPollMembershipActivation({
      isLoaded: true,
      isSignedIn: true,
      tier: "premium",
      rememberedPlan: "monthly",
    }),
    false,
  );
});

test("shouldPollMembershipActivation: false without remembered checkout plan", () => {
  assert.equal(
    shouldPollMembershipActivation({
      isLoaded: true,
      isSignedIn: true,
      tier: "free",
      rememberedPlan: null,
    }),
    false,
  );
});

test("tierFromMembershipSyncBody parses paid tiers only", () => {
  assert.equal(tierFromMembershipSyncBody({ tier: "premium" }), "premium");
  assert.equal(tierFromMembershipSyncBody({ tier: "community" }), "community");
  assert.equal(tierFromMembershipSyncBody({ tier: "free" }), "free");
  assert.equal(tierFromMembershipSyncBody({ ok: true }), null);
});

test("isPaidTier treats community and premium as paid", () => {
  assert.equal(isPaidTier("community"), true);
  assert.equal(isPaidTier("premium"), true);
  assert.equal(isPaidTier("free"), false);
});
