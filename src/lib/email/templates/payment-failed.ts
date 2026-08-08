import { SITE } from "@/lib/site";
import { emailLayout, emailCta, EMAIL_BRAND, substituteTokens } from "@/lib/email/layout";
import type { EmailAttachment } from "@/lib/email/resend-client";

export type PaymentFailedContext = { firstName?: string | null; graceDays: number };

/** Fires on payment.failed / invoice.past_due (dunning) — gated by the
 *  caller so it fires once per grace window, not on every retry. Real
 *  urgency about the consequence (losing access), no shame — cards fail for
 *  boring reasons and the copy should sound like it knows that. */
export function paymentFailedEmail(ctx: PaymentFailedContext): { subject: string; html: string; attachments: EmailAttachment[] } {
  const tokens = { firstName: ctx.firstName?.trim() || "Trader", graceDays: String(ctx.graceDays) };
  const t = (s: string) => substituteTokens(s, tokens);

  const subject = t("Your payment didn't clear — {{graceDays}} days on the clock");
  const paragraphs = [
    "{{firstName}}, your last charge got declined. Expired card, a bank flag, a routing hiccup at the processor — boring failure modes, and none of them say anything about you or your account standing.",
    "You're not locked out. Billing runs automatic retries over the next {{graceDays}} days, and your desk stays fully live while it does — SPX Slayer grades, GEX reads, flow, every engine on your plan. Clear retry, and this resolves itself. You never think about it again.",
    "If the window closes before payment updates, access suspends until it's fixed. One move closes the loop: update the card on file, and the next retry executes clean.",
  ]
    .map((p) => `<p style="margin:0 0 18px;color:${EMAIL_BRAND.body};">${t(p)}</p>`)
    .join("");

  const body = `
    <h1 style="font-size:22px;font-weight:800;margin:0 0 16px;color:${EMAIL_BRAND.ink};line-height:1.3;">Your last charge got rejected. Here's the read.</h1>
    ${paragraphs}
    ${emailCta(`${SITE.url}/account/billing`, "Update Payment Method")}
    <p style="margin:0;color:${EMAIL_BRAND.muted};font-size:14px;">The tape doesn't pause. Let's make sure your access doesn't either.</p>
  `;

  const layout = emailLayout({
    preheader: t("Expired card, bank flag, routing hiccup — the fix takes two minutes. Access holds while billing retries."),
    bodyHtml: body,
  });
  return { subject, html: layout.html, attachments: layout.attachments };
}
