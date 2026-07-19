import { test } from "node:test";
import assert from "node:assert/strict";

process.env.WHOP_PRO_PRODUCT_IDS = "prod_DVboHRgi2jgYP";

import {
  resolveBillingKindFromMembership,
  resolveBillingKindFromMemberships,
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
