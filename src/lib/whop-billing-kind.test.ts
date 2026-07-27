import { test } from "node:test";
import assert from "node:assert/strict";

process.env.WHOP_PRO_PRODUCT_IDS = "prod_DVboHRgi2jgYP";
process.env.WHOP_PRO_PLAN_IDS = "plan_prNHPwrOyFlm2";

import {
  resolveBillingKindFromMembership,
  resolveBillingKindFromMemberships,
  resolveTierFromMembership,
} from "./whop";

const premiumMembership = {
  id: "m_premium",
  status: "active" as const,
  plan: { id: "plan_1" },
  product: { id: "prod_DVboHRgi2jgYP" },
};

const communityMembership = {
  id: "m_community",
  status: "active" as const,
  plan: { id: "plan_c" },
  product: { id: "prod_hPHU7bWcvWg8T" },
};

test("resolveBillingKindFromMembership: premium product", () => {
  assert.equal(resolveBillingKindFromMembership(premiumMembership), "premium");
});

test("resolveBillingKindFromMembership: community product is not premium desk", () => {
  assert.equal(resolveBillingKindFromMembership(communityMembership), "community");
});

test("resolveBillingKindFromMemberships: premium wins over community", () => {
  assert.equal(
    resolveBillingKindFromMemberships([communityMembership, premiumMembership]),
    "premium"
  );
});

test("resolveTierFromMembership: community product resolves as community even with matching premium plan ID", () => {
  const communityWithPremiumPlan = {
    id: "m_community_leak",
    status: "active" as const,
    plan: { id: "plan_prNHPwrOyFlm2" },
    product: { id: "prod_hPHU7bWcvWg8T" },
  };
  assert.equal(resolveTierFromMembership(communityWithPremiumPlan), "community");
});

test("resolveBillingKindFromMembership: community product with premium plan ID stays community", () => {
  const communityWithPremiumPlan = {
    id: "m_community_leak2",
    status: "active" as const,
    plan: { id: "plan_prNHPwrOyFlm2" },
    product: { id: "prod_hPHU7bWcvWg8T" },
  };
  assert.equal(resolveBillingKindFromMembership(communityWithPremiumPlan), "community");
});
