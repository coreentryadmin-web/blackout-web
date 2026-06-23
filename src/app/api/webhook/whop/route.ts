import { NextRequest, NextResponse } from "next/server";
import Whop from "@whop/sdk";
import { syncWhopMembershipForEmail } from "@/lib/membership";
import { notifyOpsDiscord } from "@/lib/spx-play-notify";

function getWhopWebhookClient() {
  return new Whop({
    apiKey: process.env.WHOP_API_KEY,
    webhookKey: process.env.WHOP_WEBHOOK_SECRET ?? null,
  });
}

// Warn once at module load time so the missing var surfaces in startup logs
// even before the first webhook arrives.
if (!process.env.WHOP_WEBHOOK_SECRET?.trim()) {
  console.error(
    "[whop webhook] STARTUP WARNING: WHOP_WEBHOOK_SECRET is not set. " +
    "Incoming webhooks will be acknowledged (HTTP 200) but NOT verified or processed. " +
    "Set WHOP_WEBHOOK_SECRET in your environment to enable webhook handling."
  );
}

export async function POST(req: NextRequest) {
  if (!process.env.WHOP_WEBHOOK_SECRET?.trim()) {
    // Return 200 so Whop does not retry-loop or blacklist this endpoint.
    // The startup warning above already alerts the operator.
    console.error(
      "[whop webhook] CRITICAL: REQUEST DROPPED — WHOP_WEBHOOK_SECRET is missing. " +
      "Returning 200 to prevent Whop retry storms. Fix the env var to restore processing."
    );
    // Emit a LOUD, alertable signal so this does not stay silent at 200. Fire-and-forget
    // (matches cron-run.ts) so we still return fast and never block/throw on the webhook
    // path; notifyOpsDiscord self-guards on a missing URL.
    void notifyOpsDiscord({
      title: "Whop webhook DROPPED — WHOP_WEBHOOK_SECRET unset",
      body: "Incoming Whop webhooks are being acknowledged (HTTP 200) but NOT verified or processed. Membership changes are being silently lost. Set WHOP_WEBHOOK_SECRET to restore processing.",
      severity: "critical",
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, warning: "webhook_secret_not_configured" }, { status: 200 });
  }

  const whop = getWhopWebhookClient();
  const body = await req.text();

  // Signature verification is performed by whop.webhooks.unwrap() below. The Whop SDK
  // uses the Standard Webhooks scheme (webhook-id / webhook-timestamp / webhook-signature,
  // NOT x-whop-signature): unwrap() throws when any of those headers is missing or the
  // HMAC doesn't match, and the catch returns 400. There is no silent-skip path, so a
  // pre-check on x-whop-signature would be wrong (that header plays no role here) and
  // would 401 legitimate signed deliveries.

  const headers = Object.fromEntries(req.headers);

  let event;
  try {
    event = whop.webhooks.unwrap(body, { headers });
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  try {
    if (
      event.type === "membership.activated" ||
      event.type === "membership.deactivated"
    ) {
      const email = event.data.user?.email;
      if (email) {
        await syncWhopMembershipForEmail(email);
      } else {
        // Whop returns user.email === null when this app lacks the `member:email:read`
        // permission (or the user was deleted). syncWhopMembershipForEmail AND the
        // reconcile cron both key ONLY on email, so with no email we can neither sync
        // nor self-heal — the membership change is silently lost. Log a WARNING so the
        // missing permission surfaces (there is no id-based heal path today). Grant
        // member:email:read on the Whop app to populate user.email.
        console.warn(
          "[whop webhook] " + event.type + ": user.email is missing (null). This app likely " +
            "lacks the `member:email:read` permission, so the membership change cannot be synced " +
            "and the reconcile cron cannot heal it (both key on email). whop_user_id=" +
            (event.data.user?.id ?? "unknown") + ". Grant member:email:read on the Whop app to fix."
        );
        // Same loud-signal pattern as the missing-secret path: this membership change is
        // silently lost (no id-based heal exists), so surface it via ops alerts.
        void notifyOpsDiscord({
          title: "Whop webhook: membership change LOST — user.email is null",
          body:
            event.type +
            " could not be synced because user.email is null (app likely lacks member:email:read; reconcile cron keys on email so it cannot heal). whop_user_id=" +
            (event.data.user?.id ?? "unknown") +
            ". Grant member:email:read on the Whop app.",
          severity: "warning",
        }).catch(() => undefined);
      }
    }
  } catch (error) {
    console.error("[whop webhook]", event.type, error);
    // Surface billing-state handler failures in ops. Fire-and-forget (void + .catch,
    // matching the alerts above) so it never blocks/throws on the response path;
    // notifyOpsDiscord self-guards on a missing webhook URL.
    void notifyOpsDiscord({
      title: "Whop webhook handler FAILED (500)",
      body:
        "Processing of a Whop webhook threw — membership state may be stale. event.type=" +
        event.type +
        ". error=" +
        (error instanceof Error ? error.message : String(error)),
      severity: "critical",
    }).catch(() => undefined);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
