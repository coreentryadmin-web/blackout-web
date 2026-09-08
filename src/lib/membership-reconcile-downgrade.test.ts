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
