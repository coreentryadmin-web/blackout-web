import { SITE } from "@/lib/site";
import { emailLayout, emailCta, EMAIL_BRAND, substituteTokens } from "@/lib/email/layout";
import type { EmailAttachment } from "@/lib/email/resend-client";
import type { Tier } from "@/lib/tiers";
import type { BillingInterval } from "@/lib/billing-lifecycle-email";

export type WelcomePremiumContext = {
  firstName?: string | null;
  /** Tier the member was on immediately before this upgrade — "free" (fresh
   *  jump straight to Premium) or "community" (was already on SPX Slayer). */
  previousTier: Tier;
  billingInterval: BillingInterval | null;
};

/** Fires the moment someone becomes a Premium subscriber — either a fresh
 *  jump from free, or an upgrade off SPX Slayer. Two opening paragraphs
 *  (dual-opener) selected by previousTier, sharing everything after. */
export function welcomePremiumEmail(ctx: WelcomePremiumContext): {
  subject: string;
  html: string;
  attachments: EmailAttachment[];
} {
  const tokens = { firstName: ctx.firstName?.trim() || "Trader" };
  const t = (s: string) => substituteTokens(s, tokens);
  const fromCommunity = ctx.previousTier === "community";

  const subject = "Full desk unlocked. All six engines, live.";

  const opener = fromCommunity
    ? "{{firstName}}, you already know what SPX Slayer looks like when it's right — and when it's wrong. No hindsight edits, no deleted trades, no cherry-picking — wins and losses both stay on the record. Premium just handed you the other five instruments running on that same live feed. Same standard, five more lenses on the market."
    : "{{firstName}}, you're in. Not partway — all the way in. Every engine we run, every read we publish, every setup graded A-F before anyone knows the outcome. Most traders stitch together five different tabs and hope the picture lines up. You just skipped that part. Full read on dealer gamma exposure, institutional flow, and dark-pool prints — across the whole market, not one ticker. This is Premium.";

  const sharedParagraphs = [
    "Thermal puts dealer gamma exposure on the screen as heat, not a guess — GEX, VEX, DEX, CHARM, mapped in real time, the exact strikes where market makers get pinned, squeezed, or forced to chase their own hedges. HELIX tracks the sweeps, the blocks, the dark-pool prints institutions leave behind — surfaced as they clear, so you see size before it's a headline.",
    "Night Hawk hands you the overnight playbook before the bell, then keeps scanning intraday for 0DTE setups as they build. Largo AI is your live-data chat — ask it what's happening on the tape, and it answers off the same feed running the desk, not a script. Vector scans gamma exposure across tickers at once, so you're never stuck watching one name while the real move breaks out three symbols over.",
    "Doesn't matter if you're billed monthly or annually — access is identical, full six-engine desk, no walls between you and any of it. Monthly cancels whenever, no contract. Annual locks your rate for the full year.",
  ];

  const annualLine =
    ctx.billingInterval === "yearly"
      ? `<p style="margin:0 0 18px;color:${EMAIL_BRAND.body};">You're locked in at $1,999 for the full year — the 7-day guarantee's already come and gone, satisfied. Nothing left to decide. The desk's open. Go trade.</p>`
      : "";

  const body = `
    <h1 style="font-size:22px;font-weight:800;margin:0 0 16px;color:${EMAIL_BRAND.ink};line-height:1.3;">Every Engine. Live On Your Account.</h1>
    <p style="margin:0 0 18px;color:${EMAIL_BRAND.body};">${t(opener)}</p>
    ${sharedParagraphs.map((p) => `<p style="margin:0 0 18px;color:${EMAIL_BRAND.body};">${p}</p>`).join("")}
    ${annualLine}
    ${emailCta(`${SITE.url}/learn/getting-started`, "Open the Desk")}
    <p style="margin:0;color:${EMAIL_BRAND.muted};font-size:14px;">Every engine's live. Every grade's honest, logged before the outcome prints. See you on the desk.</p>
  `;

  const layout = emailLayout({
    preheader: "Thermal, HELIX, Night Hawk, Largo AI, Vector — five more engines, live on your account, running the same feed as SPX Slayer.",
    bodyHtml: body,
  });
  return { subject, html: layout.html, attachments: layout.attachments };
}
