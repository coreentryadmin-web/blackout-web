import { SITE } from "@/lib/site";
import { emailLayout, emailCta, EMAIL_BRAND, substituteTokens } from "@/lib/email/layout";
import type { EmailAttachment } from "@/lib/email/resend-client";
import type { BillingKind } from "@/lib/whop";

export type TrialEndingSoonContext = {
  firstName?: string | null;
  billingKind: Extract<BillingKind, "premium" | "community">;
  /** Human-readable trial end (e.g. "Monday, Sep 1"). */
  trialEndsLabel: string;
};

const PLAN_LABEL: Record<TrialEndingSoonContext["billingKind"], string> = {
  premium: "Premium",
  community: "SPX Slayer",
};

/** Fires on Whop membership.trial_ending_soon — conversion nudge before first charge. */
export function trialEndingSoonEmail(ctx: TrialEndingSoonContext): {
  subject: string;
  html: string;
  attachments: EmailAttachment[];
} {
  const planLabel = PLAN_LABEL[ctx.billingKind];
  const tokens = {
    firstName: ctx.firstName?.trim() || "Trader",
    planLabel,
    trialEndsLabel: ctx.trialEndsLabel,
  };
  const t = (s: string) => substituteTokens(s, tokens);

  const subject = t("Your {{planLabel}} trial ends {{trialEndsLabel}}");
  const paragraphs = [
    "{{firstName}}, your {{planLabel}} trial is almost up — first charge lands {{trialEndsLabel}} unless you cancel beforehand.",
    "Nothing changes on the desk until then: every engine on your plan stays live through the trial window. If you want to keep access after, make sure the card on file is current so billing clears on the first retry.",
    "Not ready to continue? Open your billing portal from Account and cancel before {{trialEndsLabel}} — no hard feelings, no surprise charges.",
  ]
    .map((p) => `<p style="margin:0 0 18px;color:${EMAIL_BRAND.body};">${t(p)}</p>`)
    .join("");

  const body = `
    <h1 style="font-size:22px;font-weight:800;margin:0 0 16px;color:${EMAIL_BRAND.ink};line-height:1.3;">Trial ending soon — here's the clock.</h1>
    ${paragraphs}
    ${emailCta(`${SITE.url}/account`, "Review billing")}
    <p style="margin:0;color:${EMAIL_BRAND.muted};font-size:14px;">Questions about your plan? Email billing@blackouttrades.com — we answer personally.</p>
  `;

  const layout = emailLayout({
    preheader: t("Your {{planLabel}} trial ends {{trialEndsLabel}}. Update billing or cancel before the first charge."),
    bodyHtml: body,
  });
  return { subject, html: layout.html, attachments: layout.attachments };
}

/** Format renewal_period_end for email copy (America/New_York date). */
export function formatTrialEndLabel(iso: string | null | undefined): string {
  if (!iso) return "soon";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "soon";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  }).format(new Date(ms));
}
