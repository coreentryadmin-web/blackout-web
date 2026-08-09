// One-click unsubscribe (RFC 8058) for MARKETING-category email only (the
// welcome sequence + exit-intent cheat sheet — see lib/email/resend-client.ts's
// callers). Deliberately scoped to Resend's per-contact TOPIC subscription,
// not the account-wide suppression list: suppression blocks every future send
// to that address, including billing/account-state emails (payment failed,
// access ended, etc.) that aren't optional — a member opting out of nurture
// content shouldn't also lose the email telling them their card was declined.
// A genuine "stop emailing me entirely" already happens automatically via
// Resend on a hard bounce or spam complaint (suppression.added), no action
// needed here for that case.
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe-token";
import { dbConfigured, dbQuery } from "@/lib/db";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

async function unsubscribe(email: string, token: string): Promise<boolean> {
  if (!verifyUnsubscribeToken(email, token)) return false;

  const topicId = process.env.RESEND_TOPIC_MARKETING_ID?.trim();
  const resend = getClient();
  if (resend && topicId) {
    try {
      const result = await resend.contacts.topics.update({ email, topics: [{ id: topicId, subscription: "opt_out" }] });
      if (result.error) console.warn("[email-unsubscribe] contacts.topics.update failed", result.error);
    } catch (err) {
      console.warn("[email-unsubscribe] contacts.topics.update threw", err);
    }
  }

  if (dbConfigured()) {
    try {
      // Stop any remaining welcome-sequence steps for this address — no point
      // opting them out of the topic but still cron-sending days 2/4/6/8.
      await dbQuery(
        `UPDATE welcome_sequence_state SET completed_at = NOW(), next_send_at = NULL
         WHERE LOWER(email) = LOWER($1) AND completed_at IS NULL`,
        [email]
      );
    } catch (err) {
      console.warn("[email-unsubscribe] failed to stop welcome sequence", err);
    }
  }

  return true;
}

function confirmationHtml(ok: boolean): string {
  const message = ok
    ? "You're unsubscribed. You won't get any more onboarding or product-update emails from BlackOut Trades."
    : "That link looks invalid or expired.";
  const sub = ok
    ? "Billing and account emails (payment issues, cancellation confirmations, etc.) still send — those aren't marketing, they're about your account."
    : "Reply to any email from us and we'll take care of it manually.";
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>Unsubscribe — BlackOut Trades</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:48px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:14px;border:1px solid #e5e7eb;padding:32px;text-align:center;">
<tr><td>
<h1 style="font-size:19px;color:#0f172a;margin:0 0 12px;">${message}</h1>
<p style="font-size:14px;color:#64748b;margin:0;">${sub}</p>
</td></tr>
</table>
</td></tr></table>
</body>
</html>`;
}

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email") ?? "";
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const ok = email && token ? await unsubscribe(email, token) : false;
  return new NextResponse(confirmationHtml(ok), {
    headers: { ...NO_STORE_HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
}

/** RFC 8058 one-click: compliant mail clients POST here directly with no page
 *  load when a member clicks "Unsubscribe" in their inbox's own UI. */
export async function POST(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email") ?? "";
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (email && token) await unsubscribe(email, token);
  return new NextResponse(null, { status: 200, headers: NO_STORE_HEADERS });
}
