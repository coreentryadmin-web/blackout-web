import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { resolveAdminApi } from "@/lib/admin-access";
import { logAdminAction } from "@/lib/admin-audit";
import { parseAdminUserRole, upsertAdminUserRow } from "@/lib/admin-users";
import { isCognitoAuth } from "@/lib/auth-provider";
import { syncWhopMembershipForEmail } from "@/lib/membership";
import { parseTier } from "@/lib/tiers";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { actor, denied } = await resolveAdminApi();
  if (denied) return denied;

  if (isCognitoAuth()) {
    return NextResponse.json({ error: "User management requires Clerk auth." }, { status: 501 });
  }

  const body = await req.json();
  const { email, firstName, lastName, tier, role, phone, syncWhop } = body;

  if (!email?.trim()) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }
  if (!phone?.trim()) {
    return NextResponse.json(
      { error: "Phone number is required for manual account creation" },
      { status: 400 }
    );
  }

  const parsedRole = parseAdminUserRole(role);
  if (role != null && role !== "" && parsedRole === undefined) {
    return NextResponse.json({ error: "Invalid role — use admin or member" }, { status: 400 });
  }

  const client = await clerkClient();

  try {
    const user = await client.users.createUser({
      emailAddress: [email.trim()],
      phoneNumber: [phone.trim()],
      firstName: firstName?.trim() || undefined,
      lastName: lastName?.trim() || undefined,
      skipPasswordRequirement: true,
      skipPasswordChecks: true,
      skipLegalChecks: true,
      publicMetadata: {
        tier: parseTier(tier),
        tier_managed_by: "admin",
        ...(parsedRole === "admin" ? { role: "admin" } : {}),
      },
    });

    await upsertAdminUserRow({
      clerkUserId: user.id,
      email: email.trim(),
      firstName: user.firstName,
      lastName: user.lastName,
      tier: parseTier(tier),
      role: parsedRole ?? "member",
    });

    let whopTier: string | null = null;
    if (syncWhop !== false) {
      try {
        const synced = await syncWhopMembershipForEmail(email.trim());
        whopTier = synced.tier;
        await upsertAdminUserRow({
          clerkUserId: user.id,
          tier: synced.tier,
          membershipKind: synced.billingKind,
        });
      } catch (err) {
        console.warn("[admin-users] Whop sync after create failed:", err);
      }
    }

    void logAdminAction({
      actorUserId: actor?.userId,
      actorEmail: actor?.email,
      action: "admin_user_create",
      detail: {
        targetUserId: user.id,
        targetEmail: email.trim(),
        tier: parseTier(tier),
        whopTier,
      },
    });

    console.log(
      "[admin-users] %s created user %s (%s)",
      actor!.email,
      user.id,
      email.trim().replace(/[\r\n]/g, "")
    );

    return NextResponse.json({ id: user.id, email, whopTier }, { status: 201 });
  } catch (err) {
    const errors = (err as { errors?: Array<{ message: string }> })?.errors;
    const msg = errors?.[0]?.message ?? "Failed to create user";
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
