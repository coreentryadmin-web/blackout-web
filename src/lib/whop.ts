import Whop from "@whop/sdk";
import type { MembershipListResponse } from "@whop/sdk/resources/memberships.js";
import { maxTier, type Tier } from "@/lib/tiers";

type WhopMembershipLike = Pick<MembershipListResponse, "status" | "plan" | "product">;

const ACTIVE_STATUSES = new Set<WhopMembershipLike["status"]>([
  "active",
  "trialing",
  "past_due",
  "canceling",
]);
let client: Whop | null = null;

export function getWhopClient(): Whop {
  if (!client) {
    const apiKey = process.env.WHOP_API_KEY;
    if (!apiKey) throw new Error("Missing WHOP_API_KEY");
    client = new Whop({ apiKey });
  }
  return client;
}

function parseIdList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export function resolveTierFromMembership(membership: WhopMembershipLike): Tier | null {
  if (!ACTIVE_STATUSES.has(membership.status)) return null;

  const planId = membership.plan.id;
  const productId = membership.product.id;

  const elitePlans = parseIdList(process.env.WHOP_ELITE_PLAN_IDS);
  const eliteProducts = parseIdList(process.env.WHOP_ELITE_PRODUCT_IDS);
  const proPlans = parseIdList(process.env.WHOP_PRO_PLAN_IDS);
  const proProducts = parseIdList(process.env.WHOP_PRO_PRODUCT_IDS);

  if (elitePlans.includes(planId) || eliteProducts.includes(productId)) return "elite";
  if (proPlans.includes(planId) || proProducts.includes(productId)) return "pro";

  return null;
}

export function resolveTierFromMemberships(memberships: WhopMembershipLike[]): Tier {
  let tier: Tier = "free";
  for (const membership of memberships) {
    const resolved = resolveTierFromMembership(membership);
    if (resolved) tier = maxTier(tier, resolved);
  }
  return tier;
}
