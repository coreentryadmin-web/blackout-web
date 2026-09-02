import { Resend } from "resend";
import { sanitizeForLog } from "@/lib/log-sanitize";

let client: Resend | null = null;

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!client) client = new Resend(apiKey);
  return client;
}

export function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

const DEFAULT_FROM = process.env.RESEND_FROM_EMAIL?.trim() || "BlackOut Trades <hello@send.blackouttrades.com>";

export type SendEmailResult = { ok: boolean; id?: string; error?: string };

/** Real inline (CID) attachment — see lib/email/inline-assets.ts for how these
 *  are built from the static images shipped in public/. */
export type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
  /** When set, sent as an inline attachment referenceable in the HTML via `cid:<contentId>`. */
  contentId?: string;
};

/**
 * Send one email via Resend. Never throws — a missing/misconfigured key or a
 * provider error returns { ok: false } instead, so a marketing email failure
 * never breaks the request that triggered it (matches discord-post.ts's
 * fire-and-forget contract for the same reason).
 */
export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  from?: string;
  attachments?: EmailAttachment[];
  /** Custom headers — used for List-Unsubscribe / List-Unsubscribe-Post (RFC 8058) on
   *  marketing-category sends; see lib/email/unsubscribe-token.ts. */
  headers?: Record<string, string>;
  /** Echoed back on every Resend webhook event for this send (email_events.template_tag),
   *  so delivery/open/click stats can be broken down by which template sent it. */
  tag?: string;
  /** Marketing-category sends only — when set, Resend checks the recipient
   *  contact's subscription to this topic before sending (skips silently if
   *  they've opted out via the unsubscribe link). Omit entirely for billing/
   *  lifecycle emails, which aren't optional. */
  topicId?: string | null;
}): Promise<SendEmailResult> {
  const resend = getResendClient();
  if (!resend) {
    console.warn("[resend] RESEND_API_KEY not configured — email not sent", {
      subject: sanitizeForLog(input.subject),
      to: sanitizeForLog(input.to),
    });
    return { ok: false, error: "not_configured" };
  }
  try {
    const result = await resend.emails.send({
      from: input.from ?? DEFAULT_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      attachments: input.attachments,
      headers: input.headers,
      tags: input.tag ? [{ name: "template", value: input.tag }] : undefined,
      topicId: input.topicId ?? undefined,
    });
    if (result.error) {
      console.warn("[resend] send failed", result.error);
      return { ok: false, error: result.error.message };
    }
    return { ok: true, id: result.data?.id };
  } catch (err) {
    console.warn("[resend] send threw", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
