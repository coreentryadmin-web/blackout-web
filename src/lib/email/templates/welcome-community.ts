import { SITE } from "@/lib/site";
import { emailLayout, emailCta, EMAIL_BRAND, substituteTokens } from "@/lib/email/layout";
import type { EmailAttachment } from "@/lib/email/resend-client";

export type WelcomeCommunityContext = { firstName?: string | null };

/** Fires the moment someone subscribes to SPX Slayer ($49/mo) for the first
 *  time — free tier, no prior paid engine. */
export function welcomeCommunityEmail(ctx: WelcomeCommunityContext): {
  subject: string;
  html: string;
  attachments: EmailAttachment[];
} {
  const tokens = { firstName: ctx.firstName?.trim() || "Trader" };
  const t = (s: string) => substituteTokens(s, tokens);

  const subject = t("You're on the desk, {{firstName}}.");
  const paragraphs = [
    "{{firstName}}, you're in. SPX Slayer just went live on your account — the full 0DTE desk, live and running the second you log in.",
    "Here's what's on it: a live SPX regime read, real-time dealer gamma exposure (GEX), strike-level call/put walls. And every 0DTE setup gets graded A through F — before the outcome, not after. No hindsight, no cherry-picking. Win or lose, it gets logged against the grade it got walking in.",
    "That's the whole desk in one sentence: the grade posts before the bell, and it stays on the record no matter what happens next. Wins and losses, side by side, forever.",
    "First move: don't just stare at the tape. Take five minutes on the walkthrough and the whole board clicks — where the gamma flip sits, how to read GEX against price, how grades update as 0DTE decay compresses through the session. Down the road, if you ever want the wider desk — Thermal, HELIX, Night Hawk, Largo AI, Vector — Premium's there. Not today's problem. Today's problem is 0DTE, and you've already got the tools for it.",
  ].map((p) => `<p style="margin:0 0 18px;color:${EMAIL_BRAND.body};">${t(p)}</p>`).join("");

  const body = `
    <h1 style="font-size:22px;font-weight:800;margin:0 0 16px;color:${EMAIL_BRAND.ink};line-height:1.3;">Welcome to SPX Slayer. The 0DTE desk is live.</h1>
    ${paragraphs}
    ${emailCta(`${SITE.url}/learn/getting-started`, "Start the 5-Minute Walkthrough")}
    <p style="margin:0;color:${EMAIL_BRAND.muted};font-size:14px;">${t("Grades post live, every single one. Desk's open — let's work.")}</p>
  `;

  const layout = emailLayout({
    preheader: "SPX Slayer just went live on your account — live SPX regime read, real-time GEX, and every 0DTE setup graded A-F before the outcome.",
    bodyHtml: body,
  });
  return { subject, html: layout.html, attachments: layout.attachments };
}
