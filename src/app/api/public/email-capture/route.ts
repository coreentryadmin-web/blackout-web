// Public, unauthenticated, rate-limited email capture — powers the exit-intent
// popup (docs/marketing/SEO-GROWTH.md finding #7). Records the capture, then
// sends the lead-magnet email immediately via Resend. Capture succeeds even
// if the send fails (email infra being down shouldn't lose the lead) — the
// send failure is logged, not surfaced to the caller as an error.
import { NextRequest, NextResponse } from "next/server";
import { isValidEmail, markLeadMagnetSent, recordEmailCapture } from "@/lib/email-captures";
import { sendEmail } from "@/lib/email/resend-client";
import { gexCheatSheetEmail } from "@/lib/email/templates/gex-cheat-sheet";
import { getClientIp, checkIpRateLimit, rateLimitHeaders } from "@/lib/ip-rate-limit";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Low limit — this is a form submission, not a polled read. 5/60s per IP is
// generous for a real visitor, tight for a scripted scrape of the endpoint.
const RATE_LIMIT = 5;
const RATE_WINDOW_SECS = 60;
const MAX_BODY_FIELD_LEN = 254;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkIpRateLimit(ip, "public:email-capture", RATE_LIMIT, RATE_WINDOW_SECS);
  const rlHeaders = rateLimitHeaders(rl);

  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
      { status: 429, headers: { ...NO_STORE_HEADERS, ...rlHeaders } }
    );
  }

  let body: { email?: unknown; sourcePath?: unknown; utmSource?: unknown; utmCampaign?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: { ...NO_STORE_HEADERS, ...rlHeaders } });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email || email.length > MAX_BODY_FIELD_LEN || !isValidEmail(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400, headers: { ...NO_STORE_HEADERS, ...rlHeaders } });
  }

  const sourcePath = typeof body.sourcePath === "string" ? body.sourcePath.slice(0, MAX_BODY_FIELD_LEN) : null;
  const utmSource = typeof body.utmSource === "string" ? body.utmSource.slice(0, MAX_BODY_FIELD_LEN) : null;
  const utmCampaign = typeof body.utmCampaign === "string" ? body.utmCampaign.slice(0, MAX_BODY_FIELD_LEN) : null;

  const { isNew } = await recordEmailCapture({ email, sourcePath, utmSource, utmCampaign });

  // Send on every submission (not just isNew) — a returning visitor re-submitting
  // clearly still wants the resource, and re-sending the same static email is
  // harmless (unlike re-crediting a referral or re-charging a payment).
  const { subject, html } = gexCheatSheetEmail();
  const result = await sendEmail({ to: email, subject, html });
  if (result.ok) await markLeadMagnetSent(email);

  return NextResponse.json(
    { ok: true, isNew, emailSent: result.ok },
    { headers: { ...NO_STORE_HEADERS, ...rlHeaders } }
  );
}
