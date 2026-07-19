import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { resolveAdminApi } from "@/lib/admin-access";
import { parseTier } from "@/lib/tiers";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { actor, denied } = await resolveAdminApi();
  if (denied) return denied;

  const body = await req.json();
  const { email, firstName, lastName, tier, role, phone } = body;

  if (!email?.trim()) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }
  if (!phone?.trim()) {
    return NextResponse.json(
      { error: "Phone number is required (Clerk constraint)" },
      { status: 400 }
    );
  }

  const client = await clerkClient();

  try {
    const user = await client.users.createUser({
      emailAddress: [email.trim()],
      phoneNumber: [phone.trim()],
      firstName: firstName?.trim() || undefined,
      lastName: lastName?.trim() || undefined,
      publicMetadata: {
        tier: parseTier(tier),
        ...(role ? { role } : {}),
      },
    });

    console.log(
      "[admin-users] %s created user %s (%s)",
      actor!.email,
      user.id,
      email.trim().replace(/[\r\n]/g, "")
    );

    return NextResponse.json({ id: user.id, email }, { status: 201 });
  } catch (err) {
    const errors = (err as { errors?: Array<{ message: string }> })?.errors;
    const msg = errors?.[0]?.message ?? "Failed to create user";
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
