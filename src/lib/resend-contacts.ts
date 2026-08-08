import { Resend } from "resend";
import type { Tier } from "@/lib/tiers";

/**
 * Keeps a Resend contact + tier segment in sync with a member's actual state,
 * so an admin can compose and send a broadcast straight from Resend's own
 * dashboard (Contacts -> filter by segment -> Broadcasts) — no custom in-app
 * campaign composer needed, that's what Resend's dashboard already is.
 *
 * Segment IDs are env-configured (RESEND_SEGMENT_{FREE,SPX_SLAYER,PREMIUM}_ID)
 * rather than looked up by name every call — the account only has 3 segment
 * slots on the current plan, and "Premium" reuses a pre-existing "General"
 * segment created before this feature (creating a 4th segment hit the plan's
 * cap) — see docs/marketing/SEO-GROWTH.md for the full note. Every call
 * no-ops safely if RESEND_API_KEY or the relevant env var isn't set, same
 * fire-and-forget contract as sendEmail().
 */

let client: Resend | null = null;
function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!client) client = new Resend(apiKey);
  return client;
}

function segmentIdForTier(tier: Tier): string | null {
  const key =
    tier === "premium"
      ? "RESEND_SEGMENT_PREMIUM_ID"
      : tier === "community"
        ? "RESEND_SEGMENT_SPX_SLAYER_ID"
        : "RESEND_SEGMENT_FREE_ID";
  return process.env[key]?.trim() || null;
}

const ALL_TIER_SEGMENT_ENV_KEYS = ["RESEND_SEGMENT_FREE_ID", "RESEND_SEGMENT_SPX_SLAYER_ID", "RESEND_SEGMENT_PREMIUM_ID"] as const;

/**
 * Create-or-update the Resend contact for one member and move them into the
 * segment matching their CURRENT tier (removed from the others). Call on
 * Clerk user.created and on every tier change (billing-lifecycle-email.ts's
 * transition wrapper). Never throws.
 */
export async function syncResendContact(input: { email: string; firstName?: string | null; tier: Tier }): Promise<void> {
  const resend = getClient();
  if (!resend) return;
  const email = input.email.trim().toLowerCase();
  if (!email) return;

  try {
    const created = await resend.contacts.create({
      email,
      firstName: input.firstName?.trim() || undefined,
      unsubscribed: false,
    });
    // The SDK never throws for expected API errors (e.g. "contact already
    // exists") — it returns {data: null, error}, so check .error rather than
    // relying on a catch. Resend doesn't expose a clean upsert; fall back to
    // update() on any create error rather than trying to distinguish
    // "already exists" from other failures (an update on a nonexistent
    // contact 404s harmlessly and is logged either way).
    if (created.error) {
      const updated = await resend.contacts.update({ email, firstName: input.firstName?.trim() || undefined });
      if (updated.error) {
        console.warn("[resend-contacts] create+update both failed for", email, created.error, updated.error);
        return;
      }
    }
  } catch (err) {
    console.warn("[resend-contacts] contact sync threw for", email, err);
    return;
  }

  const targetSegmentId = segmentIdForTier(input.tier);
  for (const envKey of ALL_TIER_SEGMENT_ENV_KEYS) {
    const segmentId = process.env[envKey]?.trim();
    if (!segmentId) continue;
    try {
      const result =
        segmentId === targetSegmentId
          ? await resend.contacts.segments.add({ email, segmentId })
          : await resend.contacts.segments.remove({ email, segmentId });
      // Only the "add to the correct segment" failure is worth logging — a
      // "remove" erroring because the contact was never in that segment is
      // the routine/expected case, not a real failure.
      if (result.error && segmentId === targetSegmentId) {
        console.warn("[resend-contacts] failed to add to segment", envKey, result.error);
      }
    } catch (err) {
      if (segmentId === targetSegmentId) console.warn("[resend-contacts] failed to add to segment", envKey, err);
    }
  }
}
