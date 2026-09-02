import { sharedCacheGet, sharedCacheSet, sharedCacheDel } from "@/lib/shared-cache";
import { dbConfigured, dbQuery } from "@/lib/db";

// Whop dunning grace: `past_due` memberships only grant premium while a payment-failure
// webhook has explicitly opened a grace window. Without a webhook-granted grace key, `past_due`
// resolves to free — closing the revenue leak where stale past_due rows grant premium forever.
//
// Storage: Postgres (whop_dunning_grace) is the durable source of truth — a paying member
// in webhook-granted grace must survive a Redis outage (the old Redis-only storage failed open
// toward REVOKING access on any Redis miss, and the hourly reconcile cron could persist that
// downgrade to Clerk). Redis is the hot cache in front. A Redis miss falls through to Postgres
// and only fails open toward denial when BOTH stores are unreachable or grace has genuinely expired.

const DUNNING_PREFIX = "whop:dunning:";
const DEFAULT_GRACE_SEC = 7 * 24 * 60 * 60; // 7 days
// Negative-result cache: "checked Postgres, not in grace". Short TTL keeps the common case
// (non-grace memberships checked on every tier resolution) off Postgres.
const NOT_IN_GRACE_TTL_SEC = 10 * 60;

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

function graceExpiresAt(): Date {
  return new Date(Date.now() + dunningGraceSec() * 1000);
}

function remainingGraceSec(expiresAt: Date): number {
  return Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
}

/** Start or refresh billing-retry grace for a membership (payment.failed / invoice.past_due). */
export async function markMembershipDunningGrace(membershipId: string): Promise<void> {
  if (!membershipId) return;

  const expiresAt = graceExpiresAt();
  let pgOk = false;
  if (dbConfigured()) {
    try {
      await dbQuery(
        `INSERT INTO whop_dunning_grace (membership_id, expires_at) VALUES ($1, $2)
         ON CONFLICT (membership_id) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
        [membershipId, expiresAt.toISOString()]
      );
      pgOk = true;
    } catch (err) {
      console.error(`[whop-dunning] Postgres write failed for ${membershipId}:`, err);
    }
  }

  await sharedCacheSet(DUNNING_PREFIX + membershipId, 1, dunningGraceSec());
  const redisOk = (await sharedCacheGet<number>(DUNNING_PREFIX + membershipId)) === 1;

  if (!pgOk && !redisOk) {
    throw new Error(
      `Failed to persist dunning grace for ${membershipId} — Postgres and Redis both unavailable`
    );
  }
  if (!pgOk) {
    console.error(
      `[whop-dunning] ${membershipId} grace started in Redis only (Postgres unavailable) — durable backing missing until next webhook`
    );
  }
}

/** Clear dunning grace after successful payment or deactivation. */
export async function clearMembershipDunningGrace(membershipId: string): Promise<void> {
  if (!membershipId) return;

  if (dbConfigured()) {
    try {
      await dbQuery(`DELETE FROM whop_dunning_grace WHERE membership_id = $1`, [membershipId]);
    } catch (err) {
      console.error(`[whop-dunning] Postgres delete failed for ${membershipId}:`, err);
    }
  }

  await sharedCacheDel(DUNNING_PREFIX + membershipId);
}

/** True when a past_due membership is within webhook-granted grace. Redis first (hot path),
 *  Postgres on a cache miss. Fails open (false) only when both stores are unreachable or
 *  grace has genuinely expired. */
export async function isMembershipInDunningGrace(
  membershipId: string | null | undefined
): Promise<boolean> {
  if (!membershipId) return false;

  const cached = await sharedCacheGet<number>(DUNNING_PREFIX + membershipId);
  if (cached === 1) return true;
  if (cached === 0) return false;

  if (!dbConfigured()) return false;
  try {
    const res = await dbQuery<{ expires_at: Date }>(
      `SELECT expires_at FROM whop_dunning_grace
       WHERE membership_id = $1 AND expires_at > NOW()`,
      [membershipId]
    );
    const inGrace = res.rows.length > 0;
    if (inGrace) {
      const expiresAt = new Date(res.rows[0]!.expires_at);
      await sharedCacheSet(
        DUNNING_PREFIX + membershipId,
        1,
        remainingGraceSec(expiresAt)
      ).catch(() => {});
      return true;
    }

    await sharedCacheSet(DUNNING_PREFIX + membershipId, 0, NOT_IN_GRACE_TTL_SEC).catch(() => {});
    return false;
  } catch (err) {
    console.error(`[whop-dunning] Postgres read failed for ${membershipId}:`, err);
    return false;
  }
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
