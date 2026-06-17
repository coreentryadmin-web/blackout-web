import { clerkClient } from "@clerk/nextjs/server";
import type { Membership } from "@whop/sdk/resources/shared.js";
import type { MembershipListResponse } from "@whop/sdk/resources/memberships.js";
import { type Tier } from "@/lib/tiers";
import { getWhopClient, resolveTierFromMemberships } from "@/lib/whop";

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

export async function syncWhopMembershipForEmail(email: string): Promise<{
  tier: Tier;
  updatedUserIds: string[];
}> {
  const whop = getWhopClient();
  const companyId = process.env.WHOP_COMPANY_ID;
  const normalized = email.trim().toLowerCase();

  const memberships: MembershipListResponse[] = [];
  const membershipParams = {
    ...(companyId ? { company_id: companyId } : {}),
    statuses: ["active", "trialing", "past_due", "canceling"] as MembershipListResponse["status"][],
  };

  for await (const membership of whop.memberships.list(membershipParams)) {
    const memberEmail = membership.user?.email?.toLowerCase();
    if (memberEmail === normalized) memberships.push(membership);
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
