import { headers } from 'next/headers';
import { Webhook } from 'svix';
import { WebhookEvent } from '@clerk/nextjs/server';
import { dbQuery, deleteUserDataForClerkId } from '@/lib/db';
import { primaryEmailFromClerkWebhook } from '@/lib/clerk-webhook-email';
import { syncWhopMembershipForEmail } from '@/lib/membership';
import { publishTierChanged } from '@/lib/tier-cache';

const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function syncWhopForClerkUser(clerkUserId: string, email: string | null): Promise<void> {
  if (!email?.trim()) return;
  if (!process.env.WHOP_COMPANY_ID?.trim() || !process.env.WHOP_API_KEY?.trim()) {
    console.warn('[clerk-webhook] Whop env missing — skipping membership sync');
    return;
  }
  try {
    const { tier, updatedUserIds } = await syncWhopMembershipForEmail(email);
    for (const uid of updatedUserIds) publishTierChanged(uid);
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
    if (type === 'user.created') {
      const email = primaryEmailFromClerkWebhook(data);
      const firstName = data.first_name ?? null;
      const lastName = data.last_name ?? null;

      await dbQuery(
        `INSERT INTO users (clerk_user_id, email, first_name, last_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (clerk_user_id) DO UPDATE
           SET email = EXCLUDED.email,
               first_name = EXCLUDED.first_name,
               last_name = EXCLUDED.last_name,
               updated_at = NOW()`,
        [data.id, email, firstName, lastName]
      );
      console.log(`[clerk-webhook] Provisioned user: ${data.id} (${email})`);
      await syncWhopForClerkUser(data.id, email);
    } else if (type === 'user.updated') {
      const email = primaryEmailFromClerkWebhook(data);
      const firstName = data.first_name ?? null;
      const lastName = data.last_name ?? null;

      await dbQuery(
        `UPDATE users
         SET email = $2, first_name = $3, last_name = $4, updated_at = NOW()
         WHERE clerk_user_id = $1`,
        [data.id, email, firstName, lastName]
      );
      console.log(`[clerk-webhook] Updated user: ${data.id}`);
      await syncWhopForClerkUser(data.id, email);
    } else if (type === 'user.deleted') {
      const clerkId = data.id;
      if (!clerkId) {
        console.warn('[clerk-webhook] user.deleted missing data.id — skipping');
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
