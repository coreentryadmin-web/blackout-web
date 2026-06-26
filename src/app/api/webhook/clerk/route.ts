import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { syncWhopMembershipForEmail } from "@/lib/membership";
import { dbQuery } from "@/lib/db";
import { notifyOpsDiscord } from "@/lib/spx-play-notify";
import { recordApiCall } from "@/lib/api-telemetry";

const CLERK_WEBHOOK_ENDPOINT = "webhook/clerk";

// Clerk webhook event shapes (subset we handle)
type ClerkEmailAddress = { email_address: string };
type ClerkUserCreatedEvent = { type: "user.created" | "user.updated"; data: { id: string; email_addresses?: ClerkEmailAddress[] } };
type ClerkUserDeletedEvent = { type: "user.deleted"; data: { id?: string } };
type ClerkEvent = ClerkUserCreatedEvent | ClerkUserDeletedEvent;

if (!process.env.CLERK_WEBHOOK_SECRET?.trim()) {
  console.error(
    "[clerk webhook] STARTUP WARNING: CLERK_WEBHOOK_SECRET is not set. " +
    "Incoming Clerk webhooks will not be verified or processed. " +
    "Set CLERK_WEBHOOK_SECRET in your environment."
  );
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const secret = process.env.CLERK_WEBHOOK_SECRET?.trim();

  if (!secret) {
    const isProd = process.env.NODE_ENV === "production";
    recordApiCall({
      provider: "blackout_engine",
      endpoint: CLERK_WEBHOOK_ENDPOINT,
      method: "POST",
      status: isProd ? 503 : 200,
      ok: false,
      latency_ms: Date.now() - startedAt,
      error: "webhook_secret_not_configured",
      phase: "failure",
    });
    void notifyOpsDiscord({
      title: "Clerk webhook UNVERIFIED — CLERK_WEBHOOK_SECRET unset",
      body: "Incoming Clerk user lifecycle webhooks cannot be verified. New paid users may be locked on free tier until the hourly reconcile runs. Set CLERK_WEBHOOK_SECRET.",
      severity: "critical",
    }).catch(() => undefined);
    if (isProd) {
      // 503 so Clerk retries — no event is permanently dropped
      return NextResponse.json({ error: "webhook_secret_not_configured", retryable: true }, { status: 503 });
    }
    return NextResponse.json({ ok: true, warning: "webhook_secret_not_configured" }, { status: 200 });
  }

  const body = await req.text();
  const wh = new Webhook(secret);

  let event: ClerkEvent;
  try {
    event = wh.verify(body, {
      "webhook-id": req.headers.get("webhook-id") ?? "",
      "webhook-timestamp": req.headers.get("webhook-timestamp") ?? "",
      "webhook-signature": req.headers.get("webhook-signature") ?? "",
    }) as ClerkEvent;
  } catch {
    recordApiCall({
      provider: "blackout_engine",
      endpoint: CLERK_WEBHOOK_ENDPOINT,
      method: "POST",
      status: 400,
      ok: false,
      latency_ms: Date.now() - startedAt,
      error: "invalid_webhook_signature",
      phase: "failure",
    });
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  try {
    if (event.type === "user.created" || event.type === "user.updated") {
      // Sync membership tier for every verified email on the Clerk account.
      // syncWhopMembershipForEmail handles the Whop lookup + Clerk publicMetadata write.
      // This fires immediately on sign-up so a paid user never waits for the hourly
      // membership-reconcile cron to grant their tier.
      const emails = (event.data.email_addresses ?? [])
        .map((e) => e.email_address)
        .filter(Boolean);

      if (emails.length > 0) {
        await Promise.allSettled(emails.map((email) => syncWhopMembershipForEmail(email)));
      }
    } else if (event.type === "user.deleted") {
      // GDPR: scrub per-user PG rows and Redis keys when Clerk deletes a user account.
      const userId = event.data.id;
      if (userId) {
        // PG GDPR scrub: delete all per-user rows across every table.
        // largo_messages cascade on session delete via FK.
        await Promise.allSettled([
          dbQuery("DELETE FROM user_positions WHERE user_id = $1", [userId]),
          dbQuery("DELETE FROM user_journal WHERE user_id = $1", [userId]),
          (async () => {
            const sessions = await dbQuery<{ id: string }>(
              "SELECT id FROM largo_sessions WHERE user_id = $1",
              [userId]
            );
            if (sessions.rows.length > 0) {
              const ids = sessions.rows.map((r) => r.id);
              await dbQuery("DELETE FROM largo_messages WHERE session_id = ANY($1)", [ids]);
              await dbQuery("DELETE FROM largo_sessions WHERE user_id = $1", [userId]);
            }
          })(),
        ]);
      }
    }
  } catch (error) {
    console.error("[clerk webhook]", event.type, error);
    recordApiCall({
      provider: "blackout_engine",
      endpoint: CLERK_WEBHOOK_ENDPOINT,
      method: "POST",
      status: 500,
      ok: false,
      latency_ms: Date.now() - startedAt,
      error: `handler_failed: ${event.type}: ${error instanceof Error ? error.message : String(error)}`,
      phase: "failure",
    });
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  recordApiCall({
    provider: "blackout_engine",
    endpoint: CLERK_WEBHOOK_ENDPOINT,
    method: "POST",
    status: 200,
    ok: true,
    latency_ms: Date.now() - startedAt,
  });
  return NextResponse.json({ ok: true });
}
