import { dbConfigured, dbQuery } from "@/lib/db";
import { findClerkUsersByEmail, syncWhopMembershipForEmail } from "@/lib/membership";
import { getWhopClient } from "@/lib/whop";
import { TIER_RANK, parseTier, type Tier } from "@/lib/tiers";
import { sendEmail } from "@/lib/email/resend-client";
import { welcomeCommunityEmail } from "@/lib/email/templates/welcome-community";
import { welcomePremiumEmail } from "@/lib/email/templates/welcome-premium";
import { downgradeEmail } from "@/lib/email/templates/downgrade";
import { accessEndedEmail } from "@/lib/email/templates/access-ended";
import { scheduledCancelEmail } from "@/lib/email/templates/scheduled-cancel";
import { cancelReversedEmail } from "@/lib/email/templates/cancel-reversed";
import { paymentFailedEmail } from "@/lib/email/templates/payment-failed";

export type BillingInterval = "monthly" | "yearly" | "other";

const planIntervalCache = new Map<string, BillingInterval>();

/** Resolves a Whop plan id to monthly/yearly via billing_period (days: 30 vs
 *  365 — see Whop's Plan resource). Not tracked anywhere in our own DB and
 *  not present on the webhook payload's embedded plan object, so this is a
 *  real API call — cached in-memory since a plan's billing period is fixed
 *  for its lifetime (a handful of plan ids total, so this settles after the
 *  first event of each kind rather than growing unbounded). */
export async function resolveBillingInterval(planId: string | undefined | null): Promise<BillingInterval | null> {
  if (!planId) return null;
  const cached = planIntervalCache.get(planId);
  if (cached) return cached;
  try {
    const plan = await getWhopClient().plans.retrieve(planId);
    const days = plan.billing_period;
    const interval: BillingInterval = days === 365 ? "yearly" : days === 30 ? "monthly" : "other";
    planIntervalCache.set(planId, interval);
    return interval;
  } catch (err) {
    console.warn("[billing-lifecycle-email] resolveBillingInterval failed for plan", planId, err);
    return null;
  }
}

type Transition = "upgrade" | "downgrade";

function classifyTransition(prev: Tier, next: Tier): Transition | null {
  const prevRank = TIER_RANK[prev];
  const nextRank = TIER_RANK[next];
  if (nextRank > prevRank) return "upgrade";
  if (nextRank < prevRank) return "downgrade";
  return null;
}

type UserRow = { clerk_user_id: string; tier: string | null; email: string; first_name: string | null };

async function lookupUserByEmail(email: string): Promise<{ firstName: string | null } | null> {
  if (!dbConfigured()) return null;
  try {
    const rows = await dbQuery<{ first_name: string | null }>(
      `SELECT first_name FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    );
    return rows.rows[0] ? { firstName: rows.rows[0].first_name } : null;
  } catch (err) {
    console.warn("[billing-lifecycle-email] lookupUserByEmail failed", err);
    return null;
  }
}

/**
 * Drop-in wrapper around syncWhopMembershipForEmail that ALSO fires the right
 * transactional email when a user's tier genuinely changed. Self-dedups
 * across webhook retries AND the hourly reconcile cron by diffing the DB's
 * CURRENT tier (read right before the sync) against the tier the sync
 * resolves — if nothing changed, nothing sends, so re-observing the same
 * state on a later pass is a silent no-op rather than a duplicate email.
 *
 * Deliberately used ONLY on the real-time webhook path (see
 * app/api/webhook/whop/route.ts), NOT the hourly reconcile cron
 * (reconcileAllMemberships) — a first deploy's reconcile pass correcting a
 * backlog of stale rows would otherwise fire a flood of misleading
 * "you just upgraded!" emails for drift that isn't today's news.
 */
export async function syncWhopMembershipAndNotify(
  email: string,
  opts?: { ignoreAdminTierLock?: boolean }
): Promise<Awaited<ReturnType<typeof syncWhopMembershipForEmail>>> {
  const normalized = email.trim().toLowerCase();
  const clerkUsers = await findClerkUsersByEmail(normalized);
  const clerkIds = clerkUsers.map((u) => u.id);

  const before = new Map<string, UserRow>();
  if (clerkIds.length && dbConfigured()) {
    try {
      const rows = await dbQuery<UserRow>(
        `SELECT clerk_user_id, tier, email, first_name FROM users WHERE clerk_user_id = ANY($1)`,
        [clerkIds]
      );
      for (const row of rows.rows) before.set(row.clerk_user_id, row);
    } catch (err) {
      console.warn("[billing-lifecycle-email] failed to snapshot prior tier — skipping transition email this pass", err);
    }
  }

  const result = await syncWhopMembershipForEmail(email, opts);

  for (const uid of result.updatedUserIds) {
    const prev = before.get(uid);
    if (!prev) continue; // no snapshot (brand-new row, or DB unavailable) — nothing to diff, next event catches up
    const previousTier = parseTier(prev.tier);
    const transition = classifyTransition(previousTier, result.tier);
    if (!transition) continue;
    void dispatchTransitionEmail({
      transition,
      previousTier,
      newTier: result.tier,
      email: prev.email,
      firstName: prev.first_name,
      planId: result.activeMembershipPlanId,
    }).catch((err) => console.warn("[billing-lifecycle-email] dispatch failed", err));
  }

  return result;
}

async function dispatchTransitionEmail(input: {
  transition: Transition;
  previousTier: Tier;
  newTier: Tier;
  email: string;
  firstName: string | null;
  planId?: string;
}): Promise<void> {
  const { transition, previousTier, newTier, email, firstName, planId } = input;

  if (transition === "upgrade") {
    if (newTier === "community") {
      const { subject, html, attachments } = welcomeCommunityEmail({ firstName });
      await sendEmail({ to: email, subject, html, attachments });
      return;
    }
    if (newTier === "premium") {
      const billingInterval = await resolveBillingInterval(planId);
      const { subject, html, attachments } = welcomePremiumEmail({ firstName, previousTier, billingInterval });
      await sendEmail({ to: email, subject, html, attachments });
    }
    return;
  }

  // downgrade
  if (newTier === "community") {
    // premium -> community: still paying, lost the other five engines.
    const { subject, html, attachments } = downgradeEmail({ firstName });
    await sendEmail({ to: email, subject, html, attachments });
    return;
  }
  if (newTier === "free") {
    // any paid tier -> free: full cancellation, access has ended now.
    const { subject, html, attachments } = accessEndedEmail({ firstName, previousTier });
    await sendEmail({ to: email, subject, html, attachments });
  }
}

/** membership.cancel_at_period_end_changed with cancel_at_period_end=true —
 *  not a tier change (they keep access until the period ends), so this is
 *  dispatched directly from the webhook route rather than through the
 *  tier-diff wrapper above. Looks up firstName since the webhook payload
 *  only carries the triggering email. */
export async function notifyScheduledCancellation(input: {
  email: string;
  accessUntil: Date | null;
}): Promise<void> {
  const user = await lookupUserByEmail(input.email);
  const { subject, html, attachments } = scheduledCancelEmail({ firstName: user?.firstName ?? null, accessUntil: input.accessUntil });
  const result = await sendEmail({ to: input.email, subject, html, attachments });
  if (!result.ok) console.warn("[billing-lifecycle-email] scheduled-cancel send failed", result.error);
}

/** membership.cancel_at_period_end_changed with cancel_at_period_end=false —
 *  a previously-scheduled cancellation was undone. */
export async function notifyCancellationReversed(input: { email: string }): Promise<void> {
  const user = await lookupUserByEmail(input.email);
  const { subject, html, attachments } = cancelReversedEmail({ firstName: user?.firstName ?? null });
  const result = await sendEmail({ to: input.email, subject, html, attachments });
  if (!result.ok) console.warn("[billing-lifecycle-email] cancel-reversed send failed", result.error);
}

/** payment.failed / invoice.past_due — gate on "was this membership already
 *  in dunning grace" at the CALL SITE (webhook route), not here, so a repeat
 *  failed-retry within the same grace window doesn't re-send. */
export async function notifyPaymentFailed(input: { email: string; graceDays: number }): Promise<void> {
  const user = await lookupUserByEmail(input.email);
  const { subject, html, attachments } = paymentFailedEmail({ firstName: user?.firstName ?? null, graceDays: input.graceDays });
  const result = await sendEmail({ to: input.email, subject, html, attachments });
  if (!result.ok) console.warn("[billing-lifecycle-email] payment-failed send failed", result.error);
}
