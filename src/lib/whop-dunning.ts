import { sharedCacheGet, sharedCacheSet, sharedCacheDel } from "@/lib/shared-cache";

// Whop dunning grace: `past_due` memberships only grant premium while a payment-failure
// webhook has explicitly opened a grace window. Without a webhook-granted grace key, `past_due`
// resolves to free — closing the revenue leak where stale past_due rows grant premium forever.

const DUNNING_PREFIX = "whop:dunning:";
const DEFAULT_GRACE_SEC = 7 * 24 * 60 * 60; // 7 days

function dunningGraceSec(): number {
  const raw = process.env.WHOP_DUNNING_GRACE_SEC?.trim();
  const n = raw ? Number(raw) : DEFAULT_GRACE_SEC;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_GRACE_SEC;
}

/** Start or refresh billing-retry grace for a membership (payment.failed / invoice.past_due). */
export async function markMembershipDunningGrace(membershipId: string): Promise<void> {
  if (!membershipId) return;
  await sharedCacheSet(DUNNING_PREFIX + membershipId, 1, dunningGraceSec());
}

/** Clear dunning grace after successful payment or deactivation. */
export async function clearMembershipDunningGrace(membershipId: string): Promise<void> {
  if (!membershipId) return;
  await sharedCacheDel(DUNNING_PREFIX + membershipId);
}

/** True when a past_due membership is within webhook-granted grace. Fail-open false on Redis miss. */
export async function isMembershipInDunningGrace(
  membershipId: string | null | undefined
): Promise<boolean> {
  if (!membershipId) return false;
  return (await sharedCacheGet<number>(DUNNING_PREFIX + membershipId)) === 1;
}
