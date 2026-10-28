import { Resend } from "resend";
import { sanitizeForLog } from "@/lib/log-sanitize";

let client: Resend | null = null;

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!client) client = new Resend(apiKey);
  return client;
}

const DEFAULT_FROM = process.env.RESEND_FROM_EMAIL?.trim() || "BlackOut Trades <hello@send.blackouttrades.com>";

// resend.emails.send() has no built-in timeout — the SDK's fetchRequest() just does a plain
// fetch(url, options) with whatever `options` the caller passes (node_modules/resend/dist/
// index.cjs's Emails.send/create -> Resend.post -> fetchRequest chain), so a hung upstream
// connection (slow TLS handshake, dead socket) left this call pending indefinitely. That
// mattered most for email-capture/route.ts, which `await`s sendEmail() before responding to an
// UNAUTHENTICATED caller — a hung Resend call stalled a live HTTP response with no auth gate to
// limit who could trigger it. Every other sendEmail() caller is fire-and-forget (`void ...
// .catch()`), where this would "only" leak a pending request rather than block a response, but
// the bound applies uniformly since it's set in the one shared client. 10s matches the order of
// magnitude of this codebase's other external-API timeouts (polygon-news.ts's
// NEWS_TIMEOUT_MS=8000) with a little extra margin for attachment payloads.
const SEND_TIMEOUT_MS = 10_000;

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
    const result = await resend.emails.send(
      {
        from: input.from ?? DEFAULT_FROM,
        to: input.to,
        subject: input.subject,
        html: input.html,
        attachments: input.attachments,
        headers: input.headers,
        tags: input.tag ? [{ name: "template", value: input.tag }] : undefined,
        topicId: input.topicId ?? undefined,
      },
      // The SDK's CreateEmailRequestOptions type only declares `query`/`headers` (PostOptions),
      // but its runtime Resend.post() spreads this whole object straight into fetch()'s options
      // (node_modules/resend/dist/index.cjs) — `signal` is honored, it's just untyped. Cast past
      // the gap rather than widening the SDK's own types.
      { signal: AbortSignal.timeout(SEND_TIMEOUT_MS) } as Parameters<typeof resend.emails.send>[1]
    );
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
