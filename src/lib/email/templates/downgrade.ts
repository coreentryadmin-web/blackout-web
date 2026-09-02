import { MEMBERSHIP_PRICING, usd } from "@/lib/pricing";
import { SITE } from "@/lib/site";
import { emailLayout, emailCta, EMAIL_BRAND, substituteTokens } from "@/lib/email/layout";
import type { EmailAttachment } from "@/lib/email/resend-client";

export type DowngradeContext = { firstName?: string | null };

/** Fires when a Premium member downgrades to SPX Slayer — still paying
 *  $49/mo, keeps the 0DTE desk, loses the other five engines. Respectful,
 *  no retention pitch dressed as a confirmation. */
export function downgradeEmail(ctx: DowngradeContext): { subject: string; html: string; attachments: EmailAttachment[] } {
  const tokens = { firstName: ctx.firstName?.trim() || "Trader" };
  const t = (s: string) => substituteTokens(s, tokens);

  const subject = "Downgrade confirmed. SPX Slayer's still loaded.";
  const paragraphs = [
    `{{firstName}}, done deal. Premium's off, SPX Slayer's on — ${usd(MEMBERSHIP_PRICING.community)}/mo, same card, effective this billing cycle. No proration drama, no fine print. That's the whole transaction.`,
    "Here's what stays: the full SPX Slayer desk. Live SPX regime reads, real-time GEX, every 0DTE setup graded A-F before the outcome's known. The grading ledger doesn't reset, soften, or get edited retroactively because your tier changed — wins and losses still log against the original grade, same as always.",
    "Here's what's gone dark: Thermal (GEX/VEX/DEX/CHARM heatmaps), HELIX (sweep/block/dark-pool flow scanner), Night Hawk (0DTE Command + Evening Edition), Largo AI (the data-grounded chat layer), Vector (universe gamma scanner), and Meridian (earnings desk). Six products, off your account as of now. If you leaned on the flow scanner or the intraday command desk, you'll notice on the next session.",
    "No guilt trip here — one click puts Premium back on whenever you want it, same account, same login, no re-onboarding. If SPX Slayer covers what you actually trade, there's nothing left to do. Your desk, your call.",
  ]
    .map((p) => `<p style="margin:0 0 18px;color:${EMAIL_BRAND.body};">${t(p)}</p>`)
    .join("");

  const body = `
    <h1 style="font-size:22px;font-weight:800;margin:0 0 16px;color:${EMAIL_BRAND.ink};line-height:1.3;">Scope changed. Standard didn't.</h1>
    ${paragraphs}
    ${emailCta(`${SITE.url}/account`, "Manage Your Plan")}
    <p style="margin:0;color:${EMAIL_BRAND.muted};font-size:14px;">Either way, the grading stands — that was never the part up for negotiation. Trade sharp.</p>
  `;

  const layout = emailLayout({
    preheader: "Full 0DTE desk, full A-F grading — five engines went dark. Here's the exact scope.",
    bodyHtml: body,
  });
  return { subject, html: layout.html, attachments: layout.attachments };
}
