import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { resolveAdminApi } from "@/lib/admin-access";
import { logAdminAction } from "@/lib/admin-audit";
import {
  assertAdminSelfGuard,
  parseAdminUserRole,
  upsertAdminUserRow,
} from "@/lib/admin-users";
import { isCognitoAuth } from "@/lib/auth-provider";
import { deleteUserDataForClerkId } from "@/lib/db";
import { updateClerkMembershipMetadata } from "@/lib/membership";
import { parseTier } from "@/lib/tiers";
import { publishTierChanged } from "@/lib/tier-cache";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { denied } = await resolveAdminApi();
  if (denied) return denied;

  if (isCognitoAuth()) {
    return NextResponse.json({ error: "User management requires Clerk auth." }, { status: 501 });
  }

  const { id } = await params;
  const client = await clerkClient();

  try {
    const user = await client.users.getUser(id);
    const meta = (user.publicMetadata ?? {}) as Record<string, unknown>;
    const primaryEmail =
      user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ?? null;

    return NextResponse.json({
      id: user.id,
      email: primaryEmail,
      allEmails: user.emailAddresses.map((e) => e.emailAddress),
      firstName: user.firstName,
      lastName: user.lastName,
      imageUrl: user.imageUrl,
      tier: String(meta.tier ?? "free"),
      membershipKind: String(meta.membership_kind ?? "") || null,
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

  if (isCognitoAuth()) {
    return NextResponse.json({ error: "User management requires Clerk auth." }, { status: 501 });
  }

  const { id } = await params;
  const body = await req.json();
  const client = await clerkClient();

  if ("banned" in body && body.banned === true) {
    const selfErr = assertAdminSelfGuard(actor!.userId, id, "ban");
    if (selfErr) {
      return NextResponse.json({ error: selfErr }, { status: 400 });
    }
  }

  if ("role" in body) {
    const parsedRole = parseAdminUserRole(body.role);
    if (parsedRole === undefined) {
      return NextResponse.json({ error: "Invalid role — use admin or member" }, { status: 400 });
    }
    if (parsedRole === "member") {
      const selfErr = assertAdminSelfGuard(actor!.userId, id, "demote");
      if (selfErr) {
        return NextResponse.json({ error: selfErr }, { status: 400 });
      }
    }
  }

  const updates: Record<string, unknown> = {};

  if ("firstName" in body) updates.firstName = body.firstName;
  if ("lastName" in body) updates.lastName = body.lastName;

  if (Object.keys(updates).length > 0) {
    await client.users.updateUser(id, updates);
  }

  const metaUpdates: {
    tier?: ReturnType<typeof parseTier>;
    whop_user_id?: string;
    whop_membership_id?: string;
  } = {};

  if ("tier" in body) metaUpdates.tier = parseTier(body.tier);
  if ("whopUserId" in body) metaUpdates.whop_user_id = body.whopUserId || undefined;
  if ("whopMembershipId" in body) metaUpdates.whop_membership_id = body.whopMembershipId || undefined;

  if (Object.keys(metaUpdates).length > 0) {
    await updateClerkMembershipMetadata(id, metaUpdates);
    if ("tier" in metaUpdates) publishTierChanged(id);
  }

  if ("role" in body) {
    const parsedRole = parseAdminUserRole(body.role)!;
    await client.users.updateUserMetadata(id, {
      publicMetadata: { role: parsedRole === "admin" ? "admin" : undefined },
    });
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
  const primaryEmail =
    updated.emailAddresses.find((e) => e.id === updated.primaryEmailAddressId)?.emailAddress ?? null;

  await upsertAdminUserRow({
    clerkUserId: id,
    email: primaryEmail,
    firstName: updated.firstName,
    lastName: updated.lastName,
    tier: parseTier(meta.tier),
    whopUserId: typeof meta.whop_user_id === "string" ? meta.whop_user_id : null,
  });

  void logAdminAction({
    actorUserId: actor?.userId,
    actorEmail: actor?.email,
    action: "admin_user_update",
    detail: {
      targetUserId: id,
      targetEmail: primaryEmail,
      fields: Object.keys(body),
      banned: updated.banned,
      tier: String(meta.tier ?? "free"),
      role: String(meta.role ?? ""),
    },
  });

  console.log(
    "[admin-users] %s updated user %s",
    actor!.email,
    id.replace(/[\r\n]/g, "")
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { actor, denied } = await resolveAdminApi();
  if (denied) return denied;

  if (isCognitoAuth()) {
    return NextResponse.json({ error: "User management requires Clerk auth." }, { status: 501 });
  }

  const { id } = await params;
  const selfErr = assertAdminSelfGuard(actor!.userId, id, "delete");
  if (selfErr) {
    return NextResponse.json({ error: selfErr }, { status: 400 });
  }

  const client = await clerkClient();
  let email: string | null = null;
  try {
    const user = await client.users.getUser(id);
    email =
      user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ?? null;
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 404) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    throw err;
  }

  await client.users.deleteUser(id);
  const deleted = await deleteUserDataForClerkId(id);
  publishTierChanged(id);

  void logAdminAction({
    actorUserId: actor?.userId,
    actorEmail: actor?.email,
    action: "admin_user_delete",
    detail: { targetUserId: id, targetEmail: email, deleted },
  });

  console.log(
    "[admin-users] %s deleted user %s",
    actor!.email,
    id.replace(/[\r\n]/g, "")
  );

  return NextResponse.json({ ok: true, deleted });
}
