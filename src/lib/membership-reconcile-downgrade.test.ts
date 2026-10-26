import { test } from "node:test";
import assert from "node:assert/strict";
import { isPaidTierForReconcileDowngradeCheck } from "./membership";

// reconcileAllMemberships' step 2 ("emails of Clerk users currently marked <paid tier> →
// re-checks Whop and downgrades once the membership has actually lapsed") used to test
// `tier === "premium"` only. `community` (SPX Slayer, $49/mo, added by #1159) was never
// folded in, so a churned/refunded community subscriber whose `membership.deactivated`
// webhook drops — the exact case this cron exists to self-heal — was invisible to the
// sweep and stayed on `community` (continued /dashboard access) forever. This test pins
// the predicate the sweep now uses so that regression can't come back silently.

test("premium and community are both eligible for the reconcile downgrade re-check", () => {
  assert.equal(isPaidTierForReconcileDowngradeCheck("premium"), true);
  assert.equal(isPaidTierForReconcileDowngradeCheck("community"), true);
});

test("free and unknown/empty tier strings are not re-checked (nothing to downgrade)", () => {
  assert.equal(isPaidTierForReconcileDowngradeCheck("free"), false);
  assert.equal(isPaidTierForReconcileDowngradeCheck(""), false);
  assert.equal(isPaidTierForReconcileDowngradeCheck("admin"), false);
});

// Regression (2026-10-26): `parseTier` (src/lib/tiers.ts) has always coerced the legacy tier
// aliases "pro" and "elite" to "premium" for every OTHER consumer of publicMetadata.tier
// (resolveUserTier/tier-cache.ts grants real desk access for them right now), but this
// predicate did a raw literal `tier === "premium"` comparison instead of normalizing through
// parseTier first — so a Clerk user whose publicMetadata.tier is still the literal string
// "pro" or "elite" (pre-dating the "premium" literal; parseTier's own comment documents these
// as real legacy aliases) was invisible to this downgrade-check sweep. A churned/refunded
// legacy "pro"/"elite" subscriber whose membership.deactivated webhook dropped — the exact
// case this cron exists to self-heal, per the function's own doc-comment — would keep full
// desk access FOREVER: nothing else in the system ever re-resolves them, exactly the same
// shape as the already-fixed "community" omission documented above.
test("legacy 'pro'/'elite' tier aliases are also eligible for the reconcile downgrade re-check", () => {
  assert.equal(isPaidTierForReconcileDowngradeCheck("pro"), true);
  assert.equal(isPaidTierForReconcileDowngradeCheck("elite"), true);
});
