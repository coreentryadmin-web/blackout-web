import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { syncWhopMembershipForEmail } from "@/lib/membership";
import { acquireMembershipSyncSlot } from "@/lib/membership-sync-limit";

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Per-user server-side cooldown. Fails open if Redis is unavailable.
  const slot = await acquireMembershipSyncSlot(userId);
  if (!slot.ok) {
    return NextResponse.json(
      { error: "Sync already in progress — try again shortly" },
      { status: 429, headers: { "Retry-After": String(slot.retryAfterSec) } }
    );
  }

  const user = await currentUser();
  const email = user?.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)
    ?.emailAddress;

  if (!email) {
    return NextResponse.json({ error: "No email on account" }, { status: 400 });
  }

  try {
    const result = await syncWhopMembershipForEmail(email);
    return NextResponse.json({
      ok: true,
      tier: result.tier,
      updated: result.updatedUserIds.length,
    });
  } catch (error) {
    console.error("[membership sync]", error);
    return NextResponse.json({ error: "Failed to sync Whop membership" }, { status: 500 });
  }
}
