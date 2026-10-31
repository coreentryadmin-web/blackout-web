import { headers } from 'next/headers';
import { Webhook } from 'svix';
import { WebhookEvent } from '@clerk/nextjs/server';
import { dbQuery, deleteUserDataForClerkId } from '@/lib/db';
import { upsertAdminUserRow } from '@/lib/admin-users';
import { primaryEmailFromClerkWebhook } from '@/lib/clerk-webhook-email';
import { syncWhopMembershipForEmail } from '@/lib/membership';
import { publishTierChanged } from '@/lib/tier-cache';
import { startWelcomeSequence } from '@/lib/welcome-sequence';
import { parseTier } from '@/lib/tiers';
import type { BillingKind } from '@/lib/whop';
import { notifyOpsDiscord } from '@/features/spx/lib/spx-play-notify';
import { buildNewMemberNotificationFields } from '@/lib/clerk-new-member-notify';
import { isInternalAuditEmail } from '@/lib/internal-audit-email';
import { sharedCacheSetNx, sharedCacheDel } from '@/lib/shared-cache';

const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Clerk's webhooks ride the same Svix at-least-once delivery transport as Resend's and
// Whop's (see webhook/resend/route.ts, webhook/whop/route.ts) — Svix retries on any
// non-2xx response, and can also redeliver an already-ack'd event (network blip losing
// our 200, a dashboard-triggered "resend event", etc). `svix-id` is stable across
// redeliveries of the SAME event, so it is the correct idempotency key. Without this
// guard, a redelivered user.created re-ran syncWhopForClerkUser() and fired a SECOND
// "New member signed up" Discord ping for one real signup (startWelcomeSequence itself
// is separately protected by its own `ON CONFLICT (user_id) DO NOTHING`, but the ops
// notification and the Whop API call are not) and a redelivered user.updated re-ran the
// full tier-sync path a second time for no reason. 24h mirrors claimWhopEvent's own TTL.
const CLERK_EVENT_CLAIM_TTL_SEC = 24 * 60 * 60;

/**
 * Atomically claim a Clerk/Svix delivery id so a redelivery of the same event is skipped
 * rather than reprocessed. Returns true iff THIS call is the first to claim it. Fails
 * OPEN (treats a Redis error as "proceed") rather than ever dropping a genuine, first-time
 * delivery over an infra blip — same bias as claimWhopEvent/claimResendEvent.
 */
async function claimClerkEvent(svixId: string): Promise<boolean> {
  return sharedCacheSetNx(`clerk:event:${svixId}`, 1, CLERK_EVENT_CLAIM_TTL_SEC).catch(() => true);
}

/**
 * Release a claimed delivery id after processing FAILED, so Svix's retry of the SAME
 * event (it reuses the same svix-id) is reprocessed instead of being silently swallowed
 * as a "duplicate" of an attempt that never actually persisted anything — same reasoning
 * as releaseWhopEventClaim/releaseResendEventClaim.
 */
async function releaseClerkEventClaim(svixId: string): Promise<void> {
  await sharedCacheDel(`clerk:event:${svixId}`).catch(() => undefined);
}

function metadataFromClerkWebhook(data: WebhookEvent["data"]) {
  const meta = (
    "public_metadata" in data ? (data.public_metadata ?? {}) : {}
  ) as Record<string, unknown>;
  const membershipKind = String(meta.membership_kind ?? "");
  return {
    tier: parseTier(meta.tier),
    role: meta.role === "admin" ? "admin" : "member",
    membershipKind:
      membershipKind === "premium" || membershipKind === "community" || membershipKind === "free"
        ? (membershipKind as BillingKind)
        : null,
    whopUserId: typeof meta.whop_user_id === "string" ? meta.whop_user_id : null,
  };
}

async function syncWhopForClerkUser(
  clerkUserId: string,
  email: string | null,
  profile?: { firstName?: string | null; lastName?: string | null }
): Promise<void> {
  if (!email?.trim()) return;
  if (!process.env.WHOP_COMPANY_ID?.trim() || !process.env.WHOP_API_KEY?.trim()) {
    console.warn('[clerk-webhook] Whop env missing — skipping membership sync');
    return;
  }
  try {
    const { tier, billingKind, updatedUserIds } = await syncWhopMembershipForEmail(email);
    for (const uid of updatedUserIds) {
      publishTierChanged(uid);
      await upsertAdminUserRow({
        clerkUserId: uid,
        email,
        firstName: profile?.firstName ?? null,
        lastName: profile?.lastName ?? null,
        tier,
        membershipKind: billingKind,
      });
    }
    console.log(
      `[clerk-webhook] Whop sync for ${clerkUserId} (${email}): tier=${tier}, updated=${updatedUserIds.length}`
    );
  } catch (err) {
    // Do not fail the webhook — DB row is already committed; client sign-in sync + reconcile cron are backups.
    console.error(`[clerk-webhook] Whop sync failed for ${clerkUserId} (${email}):`, err);
  }
}

export async function POST(req: Request) {
  if (!WEBHOOK_SECRET) {
    console.error('[clerk-webhook] CLERK_WEBHOOK_SECRET not set');
    return new Response('Webhook secret not configured', { status: 500 });
  }

  // Get svix headers
  const headerPayload = await headers();
  const svix_id = headerPayload.get('svix-id');
  const svix_timestamp = headerPayload.get('svix-timestamp');
  const svix_signature = headerPayload.get('svix-signature');

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response('Missing svix headers', { status: 400 });
  }

  // Get body
  const payload = await req.json();
  const body = JSON.stringify(payload);

  // Verify signature — fail-closed on invalid sig (400)
  const wh = new Webhook(WEBHOOK_SECRET);
  let evt: WebhookEvent;

  try {
    evt = wh.verify(body, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    }) as WebhookEvent;
  } catch (err) {
    console.error('[clerk-webhook] Invalid signature:', err);
    return new Response('Invalid signature', { status: 400 });
  }

  const { type, data } = evt;
  console.log(`[clerk-webhook] Event: ${type}, id: ${data.id}`);

  // Idempotency: a redelivery of an event we already processed is ack'd without
  // reprocessing. Claimed BEFORE processing (not after) so two genuinely-concurrent
  // redeliveries can't both pass the check and both run the side effects below.
  const isFirstDelivery = await claimClerkEvent(svix_id);
  if (!isFirstDelivery) {
    console.log(`[clerk-webhook] duplicate delivery ${svix_id} (${type}) — already processed, acking`);
    return new Response('OK', { status: 200 });
  }

  try {
    if (type === "user.created" || type === "user.updated") {
      const email = primaryEmailFromClerkWebhook(data);
      const firstName = "first_name" in data ? (data.first_name ?? null) : null;
      const lastName = "last_name" in data ? (data.last_name ?? null) : null;
      const metaFields = metadataFromClerkWebhook(data);
      const userId = data.id;

      if (type === "user.created") {
        await dbQuery(
          `INSERT INTO users (
             clerk_user_id, email, first_name, last_name, tier, role, membership_kind, whop_user_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (clerk_user_id) DO UPDATE
             SET email = EXCLUDED.email,
                 first_name = EXCLUDED.first_name,
                 last_name = EXCLUDED.last_name,
                 tier = COALESCE(EXCLUDED.tier, users.tier),
                 role = COALESCE(EXCLUDED.role, users.role),
                 membership_kind = COALESCE(EXCLUDED.membership_kind, users.membership_kind),
                 whop_user_id = COALESCE(EXCLUDED.whop_user_id, users.whop_user_id),
                 updated_at = NOW()`,
          [
            userId,
            email,
            firstName,
            lastName,
            metaFields.tier,
            metaFields.role === "admin" ? "admin" : null,
            metaFields.membershipKind,
            metaFields.whopUserId,
          ]
        );
        console.log(`[clerk-webhook] Provisioned user: ${userId} (${email})`);
        // Self-guards internally (never throws) — a welcome-email hiccup must not
        // fail user provisioning or trigger a Clerk retry of the whole webhook.
        // Skip internal audit/test accounts: measured live via /api/admin/email-events,
        // welcome-step-1 bounced 1860/1862 (99.9%) over a 14-day window — almost entirely
        // these disposable addresses, which either don't exist as real mailboxes or get
        // deleted before Resend's next attempt. A 99.9% bounce rate on a transactional
        // template is a real sender-reputation risk (Gmail/Yahoo suspend bulk senders on
        // complaint/bounce rate), not just wasted send volume.
        if (email && !isInternalAuditEmail(email)) void startWelcomeSequence({ userId, email, firstName });
        // Same pattern as the Whop webhook's ops pings (membership activated/deactivated,
        // refund, payment failed) — a real-time "someone just showed up" signal, not a
        // billing alert, so severity is "info" and it never blocks/fails provisioning.
        // Internal audit/test accounts (scripts/audit/*.mjs mint dozens of these against
        // PRODUCTION Clerk every day — see the findings doc) still get provisioned normally,
        // just never page ops: this alert exists to tell a human a REAL customer showed up,
        // and a channel that's >90% bot noise trains the reader to stop looking at it.
        if (!isInternalAuditEmail(email)) {
          void notifyOpsDiscord({
            title: "New member signed up",
            body: "",
            severity: "info",
            fields: buildNewMemberNotificationFields({ email, firstName, lastName, clerkUserId: userId }),
          }).catch(() => undefined);
        }
      } else {
        await dbQuery(
          `UPDATE users
           SET email = $2,
               first_name = $3,
               last_name = $4,
               tier = $5,
               role = $6,
               membership_kind = $7,
               whop_user_id = COALESCE($8, whop_user_id),
               updated_at = NOW()
           WHERE clerk_user_id = $1`,
          [
            userId,
            email,
            firstName,
            lastName,
            metaFields.tier,
            metaFields.role === "admin" ? "admin" : null,
            metaFields.membershipKind,
            metaFields.whopUserId,
          ]
        );
        console.log(`[clerk-webhook] Updated user: ${userId}`);
      }

      // Same internal-audit skip as the welcome-email/ops-Discord calls above — audit/test
      // accounts (scripts/audit/*.mjs mint dozens against PRODUCTION Clerk every day) have no
      // Whop membership to sync, so this call was unconditionally hitting Whop's API and
      // logging a `console.error` 404 ("Not Found") for every single one — real per-account
      // outbound-call cost plus ERROR-level noise that drowns out a genuine Whop sync failure
      // for a real member. This block was simply missed when that skip pattern was added to
      // the two calls above it.
      if (!isInternalAuditEmail(email)) {
        await syncWhopForClerkUser(userId, email, { firstName, lastName });
      }
    } else if (type === "user.deleted") {
      const clerkId = data.id;
      if (!clerkId) {
        console.warn("[clerk-webhook] user.deleted missing data.id — skipping");
      } else {
        const deleted = await deleteUserDataForClerkId(clerkId);
        publishTierChanged(clerkId);
        console.log(`[clerk-webhook] Deleted user data for ${clerkId}:`, deleted);
      }
    }
  } catch (err) {
    // Fail-closed on DB errors — return 500 so Clerk retries (incl. user.deleted GDPR cleanup).
    // Release the claim so Svix's retry of this exact delivery (it reuses svix-id) gets
    // reprocessed instead of being silently ack'd as a duplicate of an attempt that never
    // actually persisted anything — the exact bug releaseWhopEventClaim/
    // releaseResendEventClaim exist to avoid.
    console.error(`[clerk-webhook] DB error on ${type}:`, err);
    await releaseClerkEventClaim(svix_id);
    return new Response("Database error", { status: 500 });
  }

  return new Response('OK', { status: 200 });
}
