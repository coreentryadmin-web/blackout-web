import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { syncWhopMembershipForEmail } from "@/lib/membership";
import { claimWebhookOnce, releaseWebhookClaim } from "@/lib/webhook-dedupe";
import { notifyOpsDiscord } from "@/lib/spx-play-notify";
import { recordApiCall } from "@/lib/api-telemetry";

// WHY THIS EXISTS: the membership-reconcile cron (~hourly) and the user clicking
// "I paid" are the only paths that link a paid Whop membership to a freshly created
// Clerk account. Until one of those fires, a paying member is treated as `free` — the
// worst first-impression. This webhook closes that gap: on `user.created` we run the
// SAME Whop→Clerk link the cron does (syncWhopMembershipForEmail), instantly.

// Telemetry endpoint label for the API ops dashboard. Recorded under the
// `blackout_engine` provider (same convention as the whop webhook) so the Clerk
// webhook is not a blind spot in /admin api health.
const CLERK_WEBHOOK_ENDPOINT = "webhook/clerk";

// Dedupe namespace for the svix message id (the `svix-id` / `webhook-id` header).
const DEDUPE_NS = "clerk";

// Read OUR env var explicitly. Clerk's verifyWebhook would otherwise fall back to
// CLERK_WEBHOOK_SIGNING_SECRET; the project convention (and the var the user sets in
// Railway + the Clerk dashboard) is CLERK_WEBHOOK_SECRET, so we pass it through
// options.signingSecret. NEVER hardcoded.
function getClerkWebhookSecret(): string | undefined {
  return process.env.CLERK_WEBHOOK_SECRET?.trim() || undefined;
}

// Warn once at module load so a missing secret surfaces in startup logs even before
// the first webhook arrives — and so the route never crashes boot when it's unset.
if (!getClerkWebhookSecret()) {
  console.error(
    "[clerk webhook] STARTUP WARNING: CLERK_WEBHOOK_SECRET is not set. " +
      "Incoming Clerk webhooks will be REJECTED (cannot verify the signature) until it is configured. " +
      "Set CLERK_WEBHOOK_SECRET in the environment to enable instant entitlement linking on user.created."
  );
}

/** Pull the best email for a Clerk user payload: the primary email, else the first. */
function extractEmail(data: {
  primary_email_address_id?: string | null;
  email_addresses?: Array<{ id: string; email_address: string }> | null;
}): string | null {
  const addrs = data.email_addresses ?? [];
  const primary = addrs.find((a) => a.id === data.primary_email_address_id)?.email_address;
  return (primary ?? addrs[0]?.email_address)?.trim().toLowerCase() || null;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();

  // FAIL-CLOSED on a missing secret. Unlike the whop webhook (which 503-retries so no
  // billing event is dropped), a missed Clerk user.created is self-healing: the
  // reconcile cron re-links the membership within the hour. So rejecting here only
  // delays the instant-link by up to the cron interval — it never strands entitlement.
  // We therefore 500 (logged + alerted) rather than silently 200-ACK, and never crash boot.
  const secret = getClerkWebhookSecret();
  if (!secret) {
    console.error(
      "[clerk webhook] CRITICAL: CLERK_WEBHOOK_SECRET is missing — cannot verify signature. " +
        "Rejecting (500). The reconcile cron still links memberships within the hour; set the secret to restore instant linking."
    );
    void notifyOpsDiscord({
      title: "Clerk webhook UNVERIFIED — CLERK_WEBHOOK_SECRET unset",
      body:
        "Incoming Clerk webhooks cannot be verified (CLERK_WEBHOOK_SECRET unset), so instant entitlement linking on user.created is OFF. " +
        "New paid members stay on `free` until the hourly reconcile cron runs. Set CLERK_WEBHOOK_SECRET now.",
      severity: "warning",
    }).catch(() => undefined);
    recordApiCall({
      provider: "blackout_engine",
      endpoint: CLERK_WEBHOOK_ENDPOINT,
      method: "POST",
      status: 500,
      ok: false,
      latency_ms: Date.now() - startedAt,
      error: "webhook_secret_not_configured",
      phase: "failure",
    });
    return NextResponse.json({ error: "webhook_secret_not_configured" }, { status: 500 });
  }

  // Verify the svix signature. verifyWebhook reads the request body + svix headers and
  // throws on a missing/invalid signature. We pass our secret explicitly. Fail-CLOSED → 401.
  let event;
  try {
    event = await verifyWebhook(req, { signingSecret: secret });
  } catch (err) {
    console.warn(
      "[clerk webhook] signature verification failed:",
      err instanceof Error ? err.message : err
    );
    recordApiCall({
      provider: "blackout_engine",
      endpoint: CLERK_WEBHOOK_ENDPOINT,
      method: "POST",
      status: 401,
      ok: false,
      latency_ms: Date.now() - startedAt,
      error: "invalid_webhook_signature",
      phase: "failure",
    });
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  // Idempotency: claim the svix message id once. A re-delivered webhook (same id)
  // returns false and is acknowledged without re-processing. The id is the `svix-id`
  // header svix signs into every delivery. We claim BEFORE processing so a concurrent
  // duplicate can't both run; on a handler failure below we RELEASE the claim so svix's
  // retry can re-process (otherwise the claim would poison-pill the id).
  const svixId = req.headers.get("svix-id") ?? "";
  const firstDelivery = await claimWebhookOnce(DEDUPE_NS, svixId);
  if (!firstDelivery) {
    recordApiCall({
      provider: "blackout_engine",
      endpoint: CLERK_WEBHOOK_ENDPOINT,
      method: "POST",
      status: 200,
      ok: true,
      latency_ms: Date.now() - startedAt,
    });
    return NextResponse.json({ ok: true, deduped: true });
  }

  try {
    // Both user.created and user.updated carry the full UserJSON (email_addresses +
    // primary_email_address_id). user.updated is handled too: an email change/verify
    // can newly match a Whop membership, so re-linking there closes another gap. Both
    // route to the SAME reconcile fn the cron uses — no duplicated linking logic.
    if (event.type === "user.created" || event.type === "user.updated") {
      const email = extractEmail(event.data);
      if (email) {
        // REUSE the cron's link/reconcile path: resolves Whop tier for this email
        // across the account's verified emails and writes Clerk publicMetadata.tier.
        await syncWhopMembershipForEmail(email);
      } else {
        console.warn(
          "[clerk webhook] " + event.type + ": no email on the Clerk user payload (id=" +
            (event.data.id ?? "unknown") + "); nothing to link."
        );
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[clerk webhook]", event.type, error);
    // Release the dedupe claim so svix's RETRY can re-process this id (a successful
    // retry is how a transient failure self-heals before the cron has to). Best-effort.
    await releaseWebhookClaim(DEDUPE_NS, svixId);
    recordApiCall({
      provider: "blackout_engine",
      endpoint: CLERK_WEBHOOK_ENDPOINT,
      method: "POST",
      status: 500,
      ok: false,
      latency_ms: Date.now() - startedAt,
      error: `handler_failed: ${event.type}: ${detail}`,
      phase: "failure",
    });
    void notifyOpsDiscord({
      title: "Clerk webhook handler FAILED (500)",
      body:
        "Processing of a Clerk webhook threw — instant entitlement link may not have applied (the reconcile cron will heal it within the hour). event.type=" +
        event.type +
        ". error=" +
        detail,
      severity: "warning",
    }).catch(() => undefined);
    // 500 so svix RETRIES (the claim was just released so the retry is allowed through).
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
