import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
import { syncWhopMembershipForEmail } from "@/lib/membership";
import { acquireMembershipSyncSlot } from "@/lib/membership-sync-limit";
import { publishTierChanged } from "@/lib/tier-cache";
import { notifyOpsDiscord } from "@/features/spx/lib/spx-play-notify";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { isInternalAuditEmail } from "@/lib/internal-audit-email";

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });
  }

  // Per-user server-side cooldown. Fails open if Redis is unavailable.
  const slot = await acquireMembershipSyncSlot(userId);
  if (!slot.ok) {
    return NextResponse.json(
      { error: "Sync already in progress — try again shortly" },
      { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": String(slot.retryAfterSec) } }
    );
  }

  const user = await currentUser();
  const email = user?.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)
    ?.emailAddress;

  if (!email) {
    return NextResponse.json({ error: "No email on account" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  // AuthSignedInRedirect.tsx fires this on EVERY authenticated sign-in paint, including every
  // temp/audit Clerk account scripts/audit/*.mjs mints against production every day — none of
  // them can ever have a real Whop membership, so this was a wasted outbound Whop API call on
  // every single one. Same isInternalAuditEmail() skip already applied to the Clerk webhook's
  // equivalent Whop sync call (docs/audit/findings-staging — 2026-08-30 cycle).
  if (isInternalAuditEmail(email)) {
    return NextResponse.json({ ok: true, tier: "free", updated: 0 }, { headers: NO_STORE_HEADERS });
  }

  try {
    const result = await syncWhopMembershipForEmail(email);
    for (const uid of result.updatedUserIds) publishTierChanged(uid);
    return NextResponse.json({
      ok: true,
      tier: result.tier,
      updated: result.updatedUserIds.length,
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[membership sync]", error);
    // Surface manual membership-sync failures in ops (warning: user-triggered, single
    // account, lower blast radius than the webhook). Fire-and-forget so it never
    // blocks/throws on the response path; notifyOpsDiscord self-guards on a missing URL.
    void notifyOpsDiscord({
      title: "Membership sync FAILED (500)",
      body:
        "syncWhopMembershipForEmail threw on a manual /api/membership/sync. error=" +
        (error instanceof Error ? error.message : String(error)),
      severity: "warning",
    }).catch(() => undefined);
    return NextResponse.json({ error: "Failed to sync Whop membership" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
