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

const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    console.error(`[clerk-webhook] DB error on ${type}:`, err);
    return new Response("Database error", { status: 500 });
  }

  return new Response('OK', { status: 200 });
}
