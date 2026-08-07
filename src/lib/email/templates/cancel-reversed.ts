import { SITE } from "@/lib/site";
import { emailLayout, emailCta, EMAIL_BRAND, substituteTokens } from "@/lib/email/layout";
import type { EmailAttachment } from "@/lib/email/resend-client";

export type CancelReversedContext = { firstName?: string | null };

/** Fires when a member who had scheduled a cancellation undoes it. Short,
 *  genuinely glad-to-have-you, low-stakes — don't oversell a non-event. */
export function cancelReversedEmail(ctx: CancelReversedContext): {
  subject: string;
  html: string;
  attachments: EmailAttachment[];
} {
  const tokens = { firstName: ctx.firstName?.trim() || "Trader" };
  const t = (s: string) => substituteTokens(s, tokens);

  const subject = "Cancel's cancelled.";
  const paragraphs = [
    "You hit undo. We noticed. Clean pull — no partial fill, no lapse — your subscription just keeps running like nothing happened.",
    "No gap. No re-signup. No reset. Billing continues on your normal cycle, same as always.",
    "The desk's exactly where you left it — GEX, flow, dark pool, all of it. Let's get back to work.",
  ]
    .map((p) => `<p style="margin:0 0 18px;color:${EMAIL_BRAND.body};">${p}</p>`)
    .join("");

  const body = `
    <h1 style="font-size:22px;font-weight:800;margin:0 0 16px;color:${EMAIL_BRAND.ink};line-height:1.3;">${t("Good call, {{firstName}}.")}</h1>
    ${paragraphs}
    ${emailCta(`${SITE.url}/dashboard`, "Back to the desk")}
    <p style="margin:0;color:${EMAIL_BRAND.muted};font-size:14px;">Glad you're still with us.</p>
  `;

  const layout = emailLayout({
    preheader: t("Billing rolls on. Access never blinked. Good call, {{firstName}}."),
    bodyHtml: body,
  });
  return { subject, html: layout.html, attachments: layout.attachments };
}
