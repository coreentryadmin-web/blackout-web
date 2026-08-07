import { SITE } from "@/lib/site";
import { emailLayout, emailCta, EMAIL_BRAND, substituteTokens } from "@/lib/email/layout";
import type { EmailAttachment } from "@/lib/email/resend-client";

export type ScheduledCancelContext = { firstName?: string | null; accessUntil: Date | null };

function formatDate(d: Date | null): string {
  if (!d || Number.isNaN(d.getTime())) return "the end of your current billing period";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/** Fires when a member toggles "cancel at period end" ON — scheduled, not
 *  immediate. They keep full access until the period ends. */
export function scheduledCancelEmail(ctx: ScheduledCancelContext): {
  subject: string;
  html: string;
  attachments: EmailAttachment[];
} {
  const tokens = { firstName: ctx.firstName?.trim() || "Trader", accessUntil: formatDate(ctx.accessUntil) };
  const t = (s: string) => substituteTokens(s, tokens);

  const subject = t("Cancellation confirmed — you're in until {{accessUntil}}");
  const paragraphs = [
    "{{firstName}}, it's done — the cancellation is in, no further charges headed your way. But nobody's cutting the feed tonight. The screens stay lit, the grades keep posting, the desk stays exactly as loud as you left it.",
    "You've got full access through {{accessUntil}}. Every engine you're paying for stays live — SPX Slayer, Thermal, HELIX, Night Hawk, Largo AI, Vector — same GEX reads, same live flow, same A-F grades logged before the outcome's known. Nothing throttles, nothing clips early.",
    `If a setup prints between now and then and you remember why you were here — undoing this is one click on your billing page. No call, no retention pitch, no "are you sure" theater.`,
  ]
    .map((p) => `<p style="margin:0 0 18px;color:${EMAIL_BRAND.body};">${t(p)}</p>`)
    .join("");

  const body = `
    <h1 style="font-size:22px;font-weight:800;margin:0 0 16px;color:${EMAIL_BRAND.ink};line-height:1.3;">The Bell Hasn't Rung Yet.</h1>
    ${paragraphs}
    ${emailCta(`${SITE.url}/account/billing`, "Manage billing")}
    <p style="margin:0;color:${EMAIL_BRAND.muted};font-size:14px;">Your call, no hard feelings — the desk's still open when you're ready. Trade well.</p>
  `;

  const layout = emailLayout({
    preheader: t("No more charges. Full access stays live through {{accessUntil}}."),
    bodyHtml: body,
  });
  return { subject, html: layout.html, attachments: layout.attachments };
}
