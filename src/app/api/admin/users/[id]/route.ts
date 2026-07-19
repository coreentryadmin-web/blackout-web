import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { resolveAdminApi } from "@/lib/admin-access";
import { parseTier } from "@/lib/tiers";
import { publishTierChanged } from "@/lib/tier-cache";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { denied } = await resolveAdminApi();
  if (denied) return denied;

  const { id } = await params;
  const client = await clerkClient();

  try {
    const user = await client.users.getUser(id);
    const meta = (user.publicMetadata ?? {}) as Record<string, unknown>;
    const primaryEmail = user.emailAddresses.find(
      (e) => e.id === user.primaryEmailAddressId
    )?.emailAddress ?? null;

    return NextResponse.json({
      id: user.id,
      email: primaryEmail,
      allEmails: user.emailAddresses.map((e) => e.emailAddress),
      firstName: user.firstName,
      lastName: user.lastName,
      imageUrl: user.imageUrl,
      tier: String(meta.tier ?? "free"),
      role: String(meta.role ?? ""),
      whopUserId: meta.whop_user_id ?? null,
      whopMembershipId: meta.whop_membership_id ?? null,
      publicMetadata: meta,
      createdAt: user.createdAt,
      lastSignInAt: user.lastSignInAt,
      lastActiveAt: user.lastActiveAt,
      banned: user.banned,
      phoneNumbers: user.phoneNumbers?.map((p) => p.phoneNumber) ?? [],
    });
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 404) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    throw err;
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { actor, denied } = await resolveAdminApi();
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();
  const client = await clerkClient();

  const updates: Record<string, unknown> = {};

  if ("firstName" in body) updates.firstName = body.firstName;
  if ("lastName" in body) updates.lastName = body.lastName;

  if (Object.keys(updates).length > 0) {
    await client.users.updateUser(id, updates);
  }

  const metaUpdates: Record<string, unknown> = {};
  if ("tier" in body) metaUpdates.tier = parseTier(body.tier);
  if ("role" in body) metaUpdates.role = body.role || undefined;
  if ("whopUserId" in body) metaUpdates.whop_user_id = body.whopUserId || undefined;
  if ("whopMembershipId" in body) metaUpdates.whop_membership_id = body.whopMembershipId || undefined;

  if (Object.keys(metaUpdates).length > 0) {
    await client.users.updateUserMetadata(id, { publicMetadata: metaUpdates });
    if ("tier" in metaUpdates) publishTierChanged(id);
  }

  if ("banned" in body) {
    if (body.banned) {
      await client.users.banUser(id);
    } else {
      await client.users.unbanUser(id);
    }
  }

  const updated = await client.users.getUser(id);
  const meta = (updated.publicMetadata ?? {}) as Record<string, unknown>;
  const primaryEmail = updated.emailAddresses.find(
    (e) => e.id === updated.primaryEmailAddressId
  )?.emailAddress ?? null;

  console.log(
    `[admin-users] ${actor!.email} updated user ${id}: ${JSON.stringify(body)}`
  );

  return NextResponse.json({
    id: updated.id,
    email: primaryEmail,
    firstName: updated.firstName,
    lastName: updated.lastName,
    tier: String(meta.tier ?? "free"),
    role: String(meta.role ?? ""),
    banned: updated.banned,
  });
}
