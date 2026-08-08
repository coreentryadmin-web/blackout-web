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

/** Grace window in whole days, for customer-facing copy (the payment-failed
 *  email) — exported so the number shown to a member always matches the
 *  actual enforcement window instead of a copy-pasted guess. */
export function dunningGraceDays(): number {
  return Math.max(1, Math.round(dunningGraceSec() / 86_400));
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

// cancel_at_period_end_changed dedup: unlike activated/deactivated (deduped by diffing
// the tier already stored in `users`) and payment.failed (deduped by the dunning-grace
// key above), this event has no other state snapshot to diff against — only the
// top-of-route Redis idempotency claim, which is documented as fail-open. On a Redis
// outage plus a Whop redelivery, a member would get "your cancellation is scheduled"
// twice. Track the last-notified boolean per membership so a redelivery of the same
// state is a no-op even if the idempotency claim didn't catch it.
const CANCEL_STATE_PREFIX = "whop:cancel-at-period-end:";
const CANCEL_STATE_TTL_SEC = 90 * 24 * 60 * 60; // 90 days — well past any real cancel/reverse cadence

/** True when this membership's cancel_at_period_end was already last-notified as `value`. */
export async function wasCancelAtPeriodEndAlreadyNotified(
  membershipId: string | null | undefined,
  value: boolean
): Promise<boolean> {
  if (!membershipId) return false;
  const stored = await sharedCacheGet<0 | 1>(CANCEL_STATE_PREFIX + membershipId);
  if (stored === undefined || stored === null) return false;
  return (stored === 1) === value;
}

/** Record the cancel_at_period_end value just notified for this membership. */
export async function markCancelAtPeriodEndNotified(
  membershipId: string | null | undefined,
  value: boolean
): Promise<void> {
  if (!membershipId) return;
  await sharedCacheSet(CANCEL_STATE_PREFIX + membershipId, value ? 1 : 0, CANCEL_STATE_TTL_SEC);
}
