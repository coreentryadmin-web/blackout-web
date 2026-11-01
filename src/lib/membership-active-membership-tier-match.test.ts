import { test } from "node:test";
import assert from "node:assert/strict";

process.env.WHOP_PRO_PRODUCT_IDS = "prod_DVboHRgi2jgYP";
process.env.WHOP_PRO_PLAN_IDS = "plan_prNHPwrOyFlm2";

import { pickActiveMembershipForResolvedTier, foldEmailTierResolution } from "./membership";
import type { MembershipListResponse } from "@whop/sdk/resources/memberships.js";

// Real community product id (default from whop.ts's getCommunityProductIds()).
const COMMUNITY_PRODUCT_ID = "prod_hPHU7bWcvWg8T";
const PREMIUM_PRODUCT_ID = "prod_DVboHRgi2jgYP";

function membership(partial: {
  id: string;
  status: MembershipListResponse["status"];
  productId: string;
  planId?: string;
  createdAt?: string;
}): MembershipListResponse {
  return {
    id: partial.id,
    status: partial.status,
    plan: { id: partial.planId ?? "plan_x" },
    product: { id: partial.productId },
    created_at: partial.createdAt,
  } as unknown as MembershipListResponse;
}

test("picks the PREMIUM membership even when a community row sorts ahead of it", () => {
  // Community row is newer (sorts first by sortMemberships' created_at tiebreak within the
  // same "active" status priority bucket) than the older premium row — the exact shape that
  // desynced `activeMembership` from the resolved tier before this fix.
  const community = membership({
    id: "m_community",
    status: "active",
    productId: COMMUNITY_PRODUCT_ID,
    planId: "plan_c",
    createdAt: "2026-06-01T00:00:00Z",
  });
  const premium = membership({
    id: "m_premium",
    status: "active",
    productId: PREMIUM_PRODUCT_ID,
    planId: "plan_premium_annual",
    createdAt: "2026-01-01T00:00:00Z",
  });
  // `sorted` as `sortMemberships` would order it: both "active", community wins the
  // created_at tiebreak, so it is sorted[0] — the exact pre-fix failure input.
  const sorted = [community, premium];

  const picked = pickActiveMembershipForResolvedTier(sorted, new Set(), "premium");

  assert.equal(
    picked?.id,
    "m_premium",
    "activeMembership must be the membership that actually earned the resolved 'premium' tier, " +
      "not whichever one merely sorted first"
  );
  assert.equal(picked?.plan.id, "plan_premium_annual");
});

test("picks the COMMUNITY membership when the resolved tier is 'community'", () => {
  const community = membership({
    id: "m_community",
    status: "active",
    productId: COMMUNITY_PRODUCT_ID,
    planId: "plan_c",
  });
  const lapsedPremium = membership({
    id: "m_premium_lapsed",
    status: "canceling",
    productId: PREMIUM_PRODUCT_ID,
    planId: "plan_premium_monthly",
  });
  // canceling sorts after active, so community is sorted[0] anyway here — but assert the
  // tier-matching behavior explicitly rather than relying on sort order alone.
  const sorted = [community, lapsedPremium];

  const picked = pickActiveMembershipForResolvedTier(sorted, new Set(), "community");

  assert.equal(picked?.id, "m_community");
});

test("falls back to the first non-revoked membership when tier is 'free' (nothing tier-specific to preserve)", () => {
  const a = membership({ id: "m_a", status: "canceling", productId: "prod_unrelated" });
  const b = membership({ id: "m_b", status: "canceling", productId: "prod_unrelated_2" });
  const sorted = [a, b];

  const picked = pickActiveMembershipForResolvedTier(sorted, new Set(), "free");

  assert.equal(picked?.id, "m_a");
});

test("skips a revoked membership even if it matches the resolved tier", () => {
  const revokedPremium = membership({
    id: "m_premium_revoked",
    status: "active",
    productId: PREMIUM_PRODUCT_ID,
    planId: "plan_premium_revoked",
    createdAt: "2026-06-01T00:00:00Z",
  });
  const activePremium = membership({
    id: "m_premium_live",
    status: "active",
    productId: PREMIUM_PRODUCT_ID,
    planId: "plan_premium_live",
    createdAt: "2026-01-01T00:00:00Z",
  });
  const sorted = [revokedPremium, activePremium];

  const picked = pickActiveMembershipForResolvedTier(
    sorted,
    new Set(["m_premium_revoked"]),
    "premium"
  );

  assert.equal(picked?.id, "m_premium_live");
});

// foldEmailTierResolution — the per-email reducer `syncWhopMembershipForEmail` (membership.ts)
// uses to combine resolutions across a Clerk user's multiple emails. These are the cross-email
// sibling of the tests above: those prove pickActiveMembershipForResolvedTier picks the right
// membership WITHIN one email's own list; these prove the outer fold doesn't let an earlier
// email's irrelevant pick block a later email's real one.

test("foldEmailTierResolution: a free email's arbitrary pick does not block a later community email's real membership", () => {
  // This is the exact pre-fix failure shape: the first email checked is free but still carries
  // some unrelated, non-qualifying Whop row (pickActiveMembershipForResolvedTier's free-tier
  // branch returns it anyway — correct for THAT email in isolation), and a later email is the
  // one that actually holds the user's real community membership.
  const freeArbitraryMembership = membership({
    id: "m_unrelated_free",
    status: "canceling",
    productId: "prod_unrelated",
  });
  const communityMembership = membership({
    id: "m_community_real",
    status: "active",
    productId: COMMUNITY_PRODUCT_ID,
  });

  let state = { tier: "free" as const, billingKind: "free" as const };
  state = foldEmailTierResolution(state, {
    tier: "free",
    billingKind: "free",
    activeMembership: freeArbitraryMembership,
  });
  state = foldEmailTierResolution(state, {
    tier: "community",
    billingKind: "community",
    activeMembership: communityMembership,
  });

  assert.equal(state.tier, "community");
  assert.equal(
    state.activeMembership?.id,
    "m_community_real",
    "activeMembership must be the membership that actually earned the resolved tier, not a " +
      "free email's unrelated throwaway pick that happened to be checked first"
  );
});

test("foldEmailTierResolution: premium always wins and re-adopts its own membership, even after an earlier community fold", () => {
  const communityMembership = membership({
    id: "m_community",
    status: "active",
    productId: COMMUNITY_PRODUCT_ID,
  });
  const premiumMembership = membership({
    id: "m_premium",
    status: "active",
    productId: PREMIUM_PRODUCT_ID,
  });

  let state = { tier: "free" as const, billingKind: "free" as const };
  state = foldEmailTierResolution(state, {
    tier: "community",
    billingKind: "community",
    activeMembership: communityMembership,
  });
  state = foldEmailTierResolution(state, {
    tier: "premium",
    billingKind: "premium",
    activeMembership: premiumMembership,
  });

  assert.equal(state.tier, "premium");
  assert.equal(state.billingKind, "premium");
  assert.equal(state.activeMembership?.id, "m_premium");
});

test("foldEmailTierResolution: all-free emails never adopt an activeMembership", () => {
  const freeArbitraryMembership1 = membership({
    id: "m_free_1",
    status: "canceling",
    productId: "prod_unrelated",
  });
  const freeArbitraryMembership2 = membership({
    id: "m_free_2",
    status: "canceling",
    productId: "prod_unrelated_2",
  });

  let state = { tier: "free" as const, billingKind: "free" as const };
  state = foldEmailTierResolution(state, {
    tier: "free",
    billingKind: "free",
    activeMembership: freeArbitraryMembership1,
  });
  state = foldEmailTierResolution(state, {
    tier: "free",
    billingKind: "free",
    activeMembership: freeArbitraryMembership2,
  });

  assert.equal(state.tier, "free");
  assert.equal(
    state.activeMembership,
    undefined,
    "a free resolution's membership pick must never be adopted — it is arbitrary by design " +
      "(pickActiveMembershipForResolvedTier's own 'nothing tier-specific to preserve' case)"
  );
});

test("foldEmailTierResolution: first community email's real membership is kept once a later email is also free", () => {
  const communityMembership = membership({
    id: "m_community_first",
    status: "active",
    productId: COMMUNITY_PRODUCT_ID,
  });
  const freeArbitraryMembership = membership({
    id: "m_free_later",
    status: "canceling",
    productId: "prod_unrelated",
  });

  let state = { tier: "free" as const, billingKind: "free" as const };
  state = foldEmailTierResolution(state, {
    tier: "community",
    billingKind: "community",
    activeMembership: communityMembership,
  });
  state = foldEmailTierResolution(state, {
    tier: "free",
    billingKind: "free",
    activeMembership: freeArbitraryMembership,
  });

  assert.equal(state.tier, "community");
  assert.equal(state.activeMembership?.id, "m_community_first");
});
