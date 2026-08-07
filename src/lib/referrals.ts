import { dbConfigured, dbQuery } from "@/lib/db";
import { notifyOpsDiscord } from "@/features/spx/lib/spx-play-notify";

export type ReferralStatus = "signed_up" | "converted" | "rewarded";

export type ReferralStats = {
  signedUp: number;
  converted: number;
  rewarded: number;
};

// Injectable deps (default to the real modules) — same pattern as
// buildPublicTrackRecord's statsOverride param (track-record-public.ts):
// lets tests pass fakes directly instead of fighting ESM module mocking.
type Deps = {
  dbConfigured: typeof dbConfigured;
  dbQuery: typeof dbQuery;
  notifyOpsDiscord: typeof notifyOpsDiscord;
};
const defaultDeps: Deps = { dbConfigured, dbQuery, notifyOpsDiscord };

/**
 * Record a referral at signup. The referral "code" is just the referrer's own
 * Clerk user ID (?ref=<userId>) — see docs/marketing/SEO-GROWTH.md finding #3
 * for why an MVP skips a separate code-generation table. The unique index on
 * referred_user_id makes this idempotent: a user can only ever be attributed
 * to the FIRST referrer whose link led them here.
 */
export async function attributeReferralSignup(
  input: {
    referrerUserId: string;
    referredUserId: string;
    referredEmail?: string | null;
  },
  deps: Deps = defaultDeps
): Promise<{ attributed: boolean }> {
  const { referrerUserId, referredUserId, referredEmail } = input;
  if (!referrerUserId || !referredUserId || referrerUserId === referredUserId) {
    return { attributed: false };
  }
  if (!deps.dbConfigured()) return { attributed: false };
  try {
    const res = await deps.dbQuery(
      `INSERT INTO referrals (referrer_user_id, referred_user_id, referred_email)
       VALUES ($1, $2, $3)
       ON CONFLICT (referred_user_id) DO NOTHING
       RETURNING id`,
      [referrerUserId, referredUserId, referredEmail ?? null]
    );
    return { attributed: (res.rowCount ?? 0) > 0 };
  } catch (err) {
    console.warn("[referrals] attributeReferralSignup failed", err);
    return { attributed: false };
  }
}

/**
 * Mark a referred user's first payment as a conversion. Called from the Whop
 * webhook's payment.succeeded / invoice.paid handler for each userId whose
 * membership just synced. No-op (returns null) if this userId was never
 * referred, or was already marked converted — safe to call on every payment
 * event without tracking "is this the first payment" separately.
 *
 * Does NOT auto-mint a reward: Whop's promoCodes API is checkout-time /
 * new-users-only discount codes, which doesn't cleanly map to "credit an
 * existing subscriber's next renewal" — see the PR description for the full
 * reasoning. Instead this notifies ops via Discord so the referrer can be
 * rewarded manually until a real reward mechanism is decided.
 */
export async function markReferralConverted(
  referredUserId: string,
  deps: Deps = defaultDeps
): Promise<{ referrerUserId: string } | null> {
  if (!deps.dbConfigured() || !referredUserId) return null;
  try {
    const res = await deps.dbQuery<{ referrer_user_id: string }>(
      `UPDATE referrals
       SET status = 'converted', converted_at = NOW()
       WHERE referred_user_id = $1 AND status = 'signed_up'
       RETURNING referrer_user_id`,
      [referredUserId]
    );
    const row = res.rows[0];
    if (!row) return null;

    void deps
      .notifyOpsDiscord({
        title: "Referral converted",
        body:
          `Referrer ${row.referrer_user_id} → referred user ${referredUserId} just converted to paid. ` +
          `No automatic reward has been issued (see docs/marketing/SEO-GROWTH.md finding #3) — reward manually.`,
        severity: "info",
      })
      .catch(() => undefined);

    return { referrerUserId: row.referrer_user_id };
  } catch (err) {
    console.warn("[referrals] markReferralConverted failed", err);
    return null;
  }
}

/** Referral counts for a referrer, by status — powers the /account panel. */
export async function getReferralStatsForUser(
  userId: string,
  deps: Deps = defaultDeps
): Promise<ReferralStats> {
  const empty: ReferralStats = { signedUp: 0, converted: 0, rewarded: 0 };
  if (!deps.dbConfigured() || !userId) return empty;
  try {
    const res = await deps.dbQuery<{ status: ReferralStatus; count: string }>(
      `SELECT status, COUNT(*)::text AS count FROM referrals WHERE referrer_user_id = $1 GROUP BY status`,
      [userId]
    );
    const stats = { ...empty };
    for (const row of res.rows) {
      const n = parseInt(row.count, 10) || 0;
      if (row.status === "signed_up") stats.signedUp += n;
      else if (row.status === "converted") stats.converted += n;
      else if (row.status === "rewarded") stats.rewarded += n;
    }
    // signed_up-only rows are STILL signed up regardless of later status, so
    // total "signed up" for display purposes is every row this referrer owns.
    stats.signedUp += stats.converted + stats.rewarded;
    return stats;
  } catch (err) {
    console.warn("[referrals] getReferralStatsForUser failed", err);
    return empty;
  }
}
