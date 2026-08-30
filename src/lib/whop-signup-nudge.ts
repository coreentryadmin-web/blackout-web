import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";

// "You paid, now go create your account" nudge — dedup so a redelivered/re-observed
// membership.activated for a member who STILL hasn't signed up doesn't re-send. Whop checkout is
// open to anyone with no BlackOut sign-in required first (see UpgradePageShell), so a genuine
// customer can complete a real charge/trial and never reach the desk: access is granted by
// matching EMAIL at Clerk sign-up, not by the Whop purchase itself, and nothing else in the
// product tells them that. See docs/audit/findings-staging for the live case this was built for.

const NUDGE_PREFIX = "whop:signup-nudge:";
// 30 days — long enough to cover a full monthly cycle without re-sending on every retry/reconcile
// pass; once they sign up, updatedUserIds stops being empty and this path never fires again anyway.
const NUDGE_TTL_SEC = 30 * 24 * 60 * 60;

/** True if this membership has already been sent the "complete your signup" nudge. Fail-open
 *  false on a cache miss/outage — a missed dedup means at most one duplicate email, never a
 *  dropped billing event, which is the safer failure direction here. */
export async function wasSignupNudgeSent(membershipId: string | null | undefined): Promise<boolean> {
  if (!membershipId) return false;
  return (await sharedCacheGet<number>(NUDGE_PREFIX + membershipId)) === 1;
}

/** Record that the nudge was just sent for this membership. */
export async function markSignupNudgeSent(membershipId: string | null | undefined): Promise<void> {
  if (!membershipId) return;
  await sharedCacheSet(NUDGE_PREFIX + membershipId, 1, NUDGE_TTL_SEC);
}
