import { Resend } from "resend";

// Strip newlines/control characters from caller-supplied strings (email
// subject/recipient) before they ever reach a log call — otherwise a crafted
// value could inject fake log entries (CodeQL: log injection). Truncated too,
// so a very long subject can't blow out log lines. Sanitized values are also
// passed as a separate structured arg rather than interpolated into the
// message string, so nothing tainted ever flows into the log format itself.
function sanitizeForLog(value: string, maxLen = 200): string {
  return value.replace(/[\r\n\t\x00-\x1f\x7f]/g, " ").slice(0, maxLen);
}

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
