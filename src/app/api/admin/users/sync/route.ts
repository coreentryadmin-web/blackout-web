import { NextRequest, NextResponse } from "next/server";
import { resolveAdminApi } from "@/lib/admin-access";
import { logAdminAction } from "@/lib/admin-audit";
import { syncWhopMembershipForEmail } from "@/lib/membership";
import { publishTierChanged } from "@/lib/tier-cache";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { actor, denied } = await resolveAdminApi();
  if (denied) return denied;

  const body = await req.json();
  const { email } = body;

  if (!email?.trim()) {
    return NextResponse.json({ error: "Email is required" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const result = await syncWhopMembershipForEmail(email.trim(), { ignoreAdminTierLock: true });
    for (const uid of result.updatedUserIds) publishTierChanged(uid);

    void logAdminAction({
      actorUserId: actor?.userId,
      actorEmail: actor?.email,
      action: "admin_user_whop_sync",
      detail: {
        targetEmail: email.trim(),
        tier: result.tier,
        billingKind: result.billingKind,
        updatedUsers: result.updatedUserIds.length,
      },
    });

    console.log(
      "[admin-users] %s synced billing for %s: tier=%s",
      actor!.email,
      email.trim().replace(/[\r\n]/g, ""),
      result.tier
    );
    return NextResponse.json({
      ...result,
      billingKind: result.billingKind,
    }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: msg }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
