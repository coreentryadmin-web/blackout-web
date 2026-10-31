import { test } from "node:test";
import assert from "node:assert/strict";

process.env.WHOP_PRO_PRODUCT_IDS = "prod_DVboHRgi2jgYP";
process.env.WHOP_PRO_PLAN_IDS = "plan_prNHPwrOyFlm2";

import { pickActiveMembershipForResolvedTier } from "./membership";
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
