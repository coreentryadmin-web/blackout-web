import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { dbConfigured, dbQuery } from "@/lib/db";

// Refund / chargeback revocation denylist (audit launch-path #6). A one-time ("completed") Whop
// purchase that is refunded or disputed can stay 'completed' forever, so status alone keeps granting
// premium. The refund.*/dispute.* webhooks add the membership id here; resolveMembershipTierForEmail
// skips any membership on this list, and the hourly reconcile cron then re-resolves the owner to free.
//
// Storage: Postgres (whop_revoked_memberships) is the durable source of truth — a security denylist
// must survive a Redis outage/flush — with shared Redis in front as the hot cache. The old
// Redis-only storage meant every revocation silently un-revoked for the duration of any Redis
// outage (isMembershipRevoked failed open); now a Redis miss falls through to Postgres and only
// fails open when BOTH stores are unreachable.

const REVOKED_PREFIX = "whop:revoked:";
const REVOKED_TTL_SEC = 400 * 24 * 60 * 60; // Redis cache TTL; Postgres rows are permanent
// Negative-result cache: "checked Postgres, not revoked". Written on every miss so a stale
// entry can be OVERWRITTEN by isMembershipRevoked's own re-check below, but — unlike a plain
// TTL cache — it is never TRUSTED on read (see the "do not short-circuit" comment on cached 0
// in isMembershipRevoked). A fresh miss's own write can otherwise race a concurrent
// markMembershipRevoked's positive write and land AFTER it (ordinary async interleaving: this
// read's SELECT can run and return zero rows just BEFORE the webhook's INSERT commits, and its
// own sharedCacheSet(...,0,...) can still complete AFTER markMembershipRevoked's
// sharedCacheSet(...,1,...) — nothing serializes the two callers' cache writes against each
// other). Trusting that stale 0 would un-revoke a refunded/charged-back membership for up to
// this TTL.
const NOT_REVOKED_TTL_SEC = 10 * 60;

/**
 * Mark a membership id as revoked (refunded / charged back). No-op on an empty id.
 * Throws when the revocation could not be durably persisted ANYWHERE — the Whop webhook
 * catch releases its idempotency claim and returns 500, so Whop retries the event.
 */
export async function markMembershipRevoked(membershipId: string): Promise<void> {
  if (!membershipId) return;

  let pgOk = false;
  if (dbConfigured()) {
    try {
      await dbQuery(
        `INSERT INTO whop_revoked_memberships (membership_id) VALUES ($1)
         ON CONFLICT (membership_id) DO NOTHING`,
        [membershipId]
      );
      pgOk = true;
    } catch (err) {
      console.error(`[whop-revocation] Postgres write failed for ${membershipId}:`, err);
    }
  }

  await sharedCacheSet(REVOKED_PREFIX + membershipId, 1, REVOKED_TTL_SEC);
  const redisOk = (await sharedCacheGet<number>(REVOKED_PREFIX + membershipId)) === 1;

  if (!pgOk && !redisOk) {
    throw new Error(
      `Failed to persist revoked membership ${membershipId} — Postgres and Redis both unavailable`
    );
  }
  if (!pgOk) {
    // Redis-only persistence (previous behavior's durability). Loud, not fatal — the write
    // is live cluster-wide right now, and the webhook shouldn't retry-loop on a DB blip
    // when access is already being denied.
    console.error(
      `[whop-revocation] ${membershipId} revoked in Redis only (Postgres unavailable) — durable backing missing until reconcile`
    );
  }
}

/**
 * True if this membership id has been revoked. Redis first (hot path), Postgres on a
 * cache miss (backfilling Redis both ways). Fails open (false) only when both stores
 * are unreachable.
 */
export async function isMembershipRevoked(membershipId: string | null | undefined): Promise<boolean> {
  if (!membershipId) return false;

  const cached = await sharedCacheGet<number>(REVOKED_PREFIX + membershipId);
  if (cached === 1) return true;
  // Do NOT short-circuit on cached === 0: markMembershipRevoked can durably write Postgres
  // while Redis still holds a stale negative written by an earlier, concurrent miss (its
  // SELECT ran before the refund/chargeback webhook's INSERT committed, but its own
  // sharedCacheSet(0) can still complete after markMembershipRevoked's sharedCacheSet(1) —
  // see the comment on NOT_REVOKED_TTL_SEC above). Only a positive Redis hit is authoritative
  // enough to skip Postgres; this mirrors whop-dunning.ts's isMembershipInDunningGrace, which
  // carries the identical guard for the identical reason.

  if (!dbConfigured()) return false;
  try {
    const res = await dbQuery<{ membership_id: string }>(
      `SELECT membership_id FROM whop_revoked_memberships WHERE membership_id = $1`,
      [membershipId]
    );
    const revoked = res.rows.length > 0;
    // Backfill the hot cache so the next check skips Postgres (short TTL on negatives).
    await sharedCacheSet(
      REVOKED_PREFIX + membershipId,
      revoked ? 1 : 0,
      revoked ? REVOKED_TTL_SEC : NOT_REVOKED_TTL_SEC
    ).catch(() => {});
    return revoked;
  } catch (err) {
    console.error(`[whop-revocation] Postgres read failed for ${membershipId}:`, err);
    return false;
  }
}
