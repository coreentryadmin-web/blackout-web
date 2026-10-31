// Resend's own delivery/engagement webhook — NOT the Whop billing webhook
// (webhook/whop) or Clerk's auth webhook (webhook/clerk). This one tells us
// what actually happened to an email AFTER sendEmail() returned { ok: true }:
// sent/delivered/opened/clicked/bounced/complained/failed/suppressed, plus
// contact.* changes. Without this, "sent successfully" from the Resend API
// call is the only signal we have — no visibility into whether anything
// downstream (delivery, opens, clicks) actually happened.
//
// Verified via the Resend SDK's built-in webhooks.verify() (Svix-based under
// the hood, same scheme Clerk's webhook uses) rather than hand-rolling
// signature checking.
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { dbConfigured, dbQuery } from "@/lib/db";
import { sharedCacheSetNx, sharedCacheDel } from "@/lib/shared-cache";

// Svix (the delivery transport Resend's webhooks ride on, same scheme the SDK's
// webhooks.verify() checks above) retries a delivery on any non-2xx response, and —
// same as every other at-least-once webhook — can also redeliver an already-ack'd
// event (network blip losing our 200, a dashboard-triggered "resend event", etc.).
// `svix-id` is stable across redeliveries of the SAME event (it's Svix's own message
// id, not a per-attempt id), so it is the correct idempotency key — the exact pattern
// webhook/whop/route.ts already uses for the same reason (see claimWhopEvent there).
// Without this, a redelivered event inserts a SECOND email_events row for the same
// delivery, inflating the admin/email-events dashboard's sent/delivered/opened/
// bounced/complained counts with phantom duplicates.
// 24h mirrors claimWhopEvent's own TTL choice — long enough to outlast Svix's retry
// window, short enough that the claim key set doesn't grow unbounded.
const RESEND_EVENT_CLAIM_TTL_SEC = 24 * 60 * 60;

/**
 * Atomically claim a Resend/Svix delivery id so a redelivery of the same event is
 * skipped rather than double-inserted. Returns true iff THIS call is the first to
 * claim it. Fails OPEN (treats a Redis error as "proceed") rather than ever dropping
 * a genuine, first-time delivery over an infra blip — same bias as every other
 * best-effort guard in this file and in ip-rate-limit.ts.
 */
async function claimResendEvent(svixId: string): Promise<boolean> {
  return sharedCacheSetNx(`resend:event:${svixId}`, 1, RESEND_EVENT_CLAIM_TTL_SEC).catch(() => true);
}

/**
 * Release a claimed delivery id after processing FAILED, so Svix's retry of the
 * SAME event (it reuses the same svix-id) is reprocessed instead of being silently
 * swallowed as a "duplicate" of an attempt that never actually persisted anything —
 * the exact bug `releaseWhopEventClaim` in webhook/whop/route.ts documents and fixes.
 */
async function releaseResendEventClaim(svixId: string): Promise<void> {
  await sharedCacheDel(`resend:event:${svixId}`).catch(() => undefined);
}

function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

/** Pulls the handful of common fields worth indexing out of the event's
 *  otherwise-shape-varying `data` payload (email.* vs contact.* vs
 *  suppression.* each carry different fields) — the full payload is always
 *  kept verbatim in `metadata` regardless, so nothing is lost if a field
 *  isn't present here. */
function extractIndexed(data: unknown): { emailId: string | null; recipient: string | null; subject: string | null; templateTag: string | null } {
  const d = data as {
    email_id?: string;
    to?: string[];
    subject?: string;
    tags?: Record<string, string>;
    email?: string; // contact.* events carry `email` directly
  };
  return {
    emailId: typeof d.email_id === "string" ? d.email_id : null,
    recipient: Array.isArray(d.to) ? d.to.join(",") : typeof d.email === "string" ? d.email : null,
    subject: typeof d.subject === "string" ? d.subject : null,
    templateTag: typeof d.tags?.template === "string" ? d.tags.template : null,
  };
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[resend webhook] RESEND_WEBHOOK_SECRET not set — cannot verify, rejecting");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const resend = getClient();
  if (!resend) {
    console.error("[resend webhook] RESEND_API_KEY not set");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const payload = await req.text();
  // The SDK's verify() wants the three raw Svix headers as a plain object, not
  // a Headers instance (Resend webhooks are Svix-signed, same scheme Clerk's
  // webhook route unwraps manually — this one goes through the SDK helper).
  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "missing_svix_headers" }, { status: 400 });
  }

  let event;
  try {
    event = resend.webhooks.verify({
      payload,
      headers: { id: svixId, timestamp: svixTimestamp, signature: svixSignature },
      webhookSecret: secret,
    });
  } catch (err) {
    console.warn("[resend webhook] signature verification failed", err);
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  if (!dbConfigured()) return NextResponse.json({ ok: true });

  // Idempotency: a redelivery of an event we already recorded is ack'd without
  // re-inserting. Claimed BEFORE processing (not after) so two genuinely-concurrent
  // redeliveries can't both pass the check and double-insert.
  const isFirstDelivery = await claimResendEvent(svixId);
  if (!isFirstDelivery) {
    console.log("[resend webhook] duplicate delivery", svixId, event.type, "— already recorded, acking");
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    const { emailId, recipient, subject, templateTag } = extractIndexed(event.data);
    const occurredAt =
      typeof (event.data as { created_at?: string }).created_at === "string"
        ? new Date((event.data as { created_at: string }).created_at)
        : new Date();
    await dbQuery(
      `INSERT INTO email_events (resend_email_id, event_type, recipient, subject, template_tag, occurred_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [emailId, event.type, recipient, subject, templateTag, occurredAt, JSON.stringify(event.data)]
    );
  } catch (err) {
    console.error("[resend webhook] failed to record event", event.type, err);
    // Release the claim so Svix's retry of this exact delivery (it reuses svix-id)
    // gets reprocessed instead of being silently ack'd as a duplicate of an attempt
    // that never persisted anything.
    await releaseResendEventClaim(svixId);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
