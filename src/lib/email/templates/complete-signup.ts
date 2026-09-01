import { SITE } from "@/lib/site";
import { emailLayout, emailCta, EMAIL_BRAND, substituteTokens } from "@/lib/email/layout";
import type { EmailAttachment } from "@/lib/email/resend-client";
import type { BillingKind } from "@/lib/whop";

export type CompleteSignupContext = {
  email: string;
  /** Which plan they paid/started a trial for — drives the copy's specifics. */
  billingKind: Extract<BillingKind, "premium" | "community">;
};

const PLAN_LABEL: Record<CompleteSignupContext["billingKind"], string> = {
  premium: "Premium",
  community: "SPX Slayer",
};

/**
 * Fires when a Whop membership goes valid (activated/trialing) for an email that has NO matching
 * BlackOut account yet. Whop checkout is deliberately open to anyone — no sign-in required before
 * paying (see UpgradePageShell) — so a member can complete a real charge/trial on Whop and never
 * see the desk, because access is granted by MATCHING EMAIL on sign-up, not by the Whop purchase
 * itself. Nothing else in the product tells them this. Gated by the caller to send once per
 * membership id (whop-signup-nudge.ts) — re-observing an already-nudged, still-unsigned-up
 * membership on a later webhook/reconcile pass must not re-send.
 */
export function completeSignupEmail(ctx: CompleteSignupContext): {
  subject: string;
  html: string;
  attachments: EmailAttachment[];
} {
  const planLabel = PLAN_LABEL[ctx.billingKind];
  const tokens = { planLabel, email: ctx.email };
  const t = (s: string) => substituteTokens(s, tokens);

  const subject = t("One step left — create your account to unlock {{planLabel}}");
  const paragraphs = [
    "Your payment went through and your {{planLabel}} access is active on our end — but the desk itself lives behind a separate BlackOut account, and we don't see one yet for this email.",
    "That's the only thing standing between you and the screens: create your account using the SAME email you just paid with ({{email}}), and access unlocks the moment you do. No second charge, nothing to re-enter — it's already paired and waiting.",
    "If you already have a BlackOut account under a different email, sign into that account and use \"Already paid? Sync now\" on the Upgrade page — it checks whichever email you're signed in with, so it only finds this payment if that account's email matches {{email}} exactly. When it doesn't, the cleanest fix is creating a fresh account with {{email}} above; email support if you're not sure which email to use.",
  ]
    .map((p) => `<p style="margin:0 0 18px;color:${EMAIL_BRAND.body};">${t(p)}</p>`)
    .join("");

  const body = `
    <h1 style="font-size:22px;font-weight:800;margin:0 0 16px;color:${EMAIL_BRAND.ink};line-height:1.3;">You paid. The desk's still waiting on you.</h1>
    ${paragraphs}
    ${emailCta(`${SITE.url}/sign-up`, "Create your account")}
    <p style="margin:0;color:${EMAIL_BRAND.muted};font-size:14px;">Same email, one click, and every engine on your plan is live.</p>
  `;

  const layout = emailLayout({
    preheader: t("Your {{planLabel}} payment is active, but you haven't created your BlackOut account yet — same email unlocks it instantly."),
    bodyHtml: body,
  });
  return { subject, html: layout.html, attachments: layout.attachments };
}
