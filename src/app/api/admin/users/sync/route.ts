import { NextRequest, NextResponse } from "next/server";
import { resolveAdminApi } from "@/lib/admin-access";
import { syncWhopMembershipForEmail } from "@/lib/membership";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { actor, denied } = await resolveAdminApi();
  if (denied) return denied;

  const body = await req.json();
  const { email } = body;

  if (!email?.trim()) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  try {
    const result = await syncWhopMembershipForEmail(email.trim());
    console.log(
      "[admin-users] %s synced Whop for %s: tier=%s",
      actor!.email,
      email.trim().replace(/[\r\n]/g, ""),
      result.tier
    );
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
