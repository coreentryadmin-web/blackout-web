import { clerkClient } from "@clerk/nextjs/server";
import type { MembershipListResponse } from "@whop/sdk/resources/memberships.js";
import { type Tier } from "@/lib/tiers";
import {
  getPremiumProductIds,
  getWhopClient,
  PREMIUM_MEMBERSHIP_STATUSES,
  resolveTierFromMemberships,
} from "@/lib/whop";

type MembershipMetadata = {
  tier?: Tier;
  whop_user_id?: string;
  whop_membership_id?: string;
};

export async function findClerkUsersByEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return [];

  const client = await clerkClient();
  const { data } = await client.users.getUserList({
    emailAddress: [normalized],
    limit: 10,
  });

  return data;
}

export async function updateClerkMembershipMetadata(
  clerkUserId: string,
  metadata: MembershipMetadata
) {
  const client = await clerkClient();
  const user = await client.users.getUser(clerkUserId);
  const existing = (user.publicMetadata ?? {}) as MembershipMetadata;

  await client.users.updateUserMetadata(clerkUserId, {
    publicMetadata: {
      ...existing,
      ...metadata,
    },
  });
}

async function findWhopUserIdsByEmail(
  email: string,
  companyId: string
): Promise<string[]> {
  const whop = getWhopClient();
  const normalized = email.trim().toLowerCase();
  const userIds = new Set<string>();

  for await (const member of whop.members.list({
    company_id: companyId,
    query: normalized,
  })) {
    const memberEmail = member.user?.email?.toLowerCase();
    if (memberEmail === normalized && member.user?.id) {
      userIds.add(member.user.id);
    }
  }

  return Array.from(userIds);
}

export async function syncWhopMembershipForEmail(email: string): Promise<{
  tier: Tier;
  updatedUserIds: string[];
}> {
  const whop = getWhopClient();
  const companyId = process.env.WHOP_COMPANY_ID;
  const normalized = email.trim().toLowerCase();
  const premiumProductIds = getPremiumProductIds();

  const userIds = companyId ? await findWhopUserIdsByEmail(normalized, companyId) : [];

  const memberships: MembershipListResponse[] = [];
  const membershipParams = {
    ...(companyId ? { company_id: companyId } : {}),
    ...(premiumProductIds.length ? { product_ids: premiumProductIds } : {}),
    ...(userIds.length ? { user_ids: userIds } : {}),
    statuses: PREMIUM_MEMBERSHIP_STATUSES,
  };

  for await (const membership of whop.memberships.list(membershipParams)) {
    if (!userIds.length) {
      const memberEmail = membership.user?.email?.toLowerCase();
      if (memberEmail !== normalized) continue;
    }
    memberships.push(membership);
  }

  const tier = resolveTierFromMemberships(memberships);
  const activeMembership = memberships[0];

  const clerkUsers = await findClerkUsersByEmail(normalized);
  const updatedUserIds: string[] = [];

  for (const user of clerkUsers) {
    await updateClerkMembershipMetadata(user.id, {
      tier,
      whop_user_id: activeMembership?.user?.id,
      whop_membership_id: activeMembership?.id,
    });
    updatedUserIds.push(user.id);
  }

  return { tier, updatedUserIds };
}
