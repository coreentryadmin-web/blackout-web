import { SITE } from "@/lib/site";
import { emailLayout } from "@/lib/email/layout";

export type WelcomeEmailContext = { firstName?: string | null };
export type WelcomeEmailStep = {
  step: number;
  /** Days after signup this step should send. Step 1 is 0 — sent immediately. */
  delayDays: number;
  build: (ctx: WelcomeEmailContext) => { subject: string; html: string };
};

function greeting(ctx: WelcomeEmailContext): string {
  return ctx.firstName?.trim() ? `Hey ${ctx.firstName.trim()},` : "Hey,";
}

function cta(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 22px;"><tr><td style="border-radius:8px;background:#0891b2;">
    <a href="${href}" style="display:inline-block;padding:13px 26px;font-weight:700;color:#ffffff;text-decoration:none;font-size:14px;">${label}</a>
  </td></tr></table>`;
}

function h1(text: string): string {
  return `<h1 style="font-size:21px;font-weight:800;margin:0 0 16px;color:#0f172a;">${text}</h1>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 18px;color:#334155;">${text}</p>`;
}

export const WELCOME_SEQUENCE: WelcomeEmailStep[] = [
  // Day 0 — orient, one clear first action.
  {
    step: 1,
    delayDays: 0,
    build: (ctx) => {
      const subject = "Welcome to BlackOut — start here";
      const body =
        h1(`${greeting(ctx)} you're in.`) +
        p("BlackOut maps dealer gamma exposure, institutional options flow, and dark pool activity into one desk — the positioning picture professional desks trade on.") +
        p("Six engines, one thing in common: nothing here is a guess. Every number traces back to live data.") +
        cta(`${SITE.url}/learn/getting-started`, "Start here — 5 minute orientation →") +
        `<p style="margin:0;color:#64748b;font-size:14px;">Over the next week I'll send a few short emails covering the framework and the tools — no fluff, just what actually matters before your first trade. And if you want to talk shop with other members, the <a href="${SITE.social.discord.url}" style="color:#0891b2;text-decoration:none;">Discord</a> is open.</p>`;
      return { subject, html: emailLayout({ preheader: "Six engines, one desk — here's where to start.", bodyHtml: body }) };
    },
  },
  // Day 2 — GEX education, tie to the free tool.
  {
    step: 2,
    delayDays: 2,
    build: (ctx) => {
      const subject = "The 3 terms that explain most of SPX's moves";
      const body =
        h1(`${greeting(ctx)} let's talk gamma.`) +
        p("Three terms cover most of what actually pins or accelerates SPX on a given day:") +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
          <tr><td style="padding:14px 16px;border-left:3px solid #0891b2;background:#f8fafc;border-radius:0 8px 8px 0;">
            <p style="margin:0 0 4px;font-weight:700;color:#0f172a;">Gamma Flip</p>
            <p style="margin:0;color:#475569;font-size:14px;">Above it, dealer hedging dampens moves. Below it, hedging amplifies them.</p>
          </td></tr>
          <tr><td style="height:10px;"></td></tr>
          <tr><td style="padding:14px 16px;border-left:3px solid #16a34a;background:#f8fafc;border-radius:0 8px 8px 0;">
            <p style="margin:0 0 4px;font-weight:700;color:#0f172a;">Call Wall</p>
            <p style="margin:0;color:#475569;font-size:14px;">Largest positive dealer gamma strike — mechanical resistance.</p>
          </td></tr>
          <tr><td style="height:10px;"></td></tr>
          <tr><td style="padding:14px 16px;border-left:3px solid #dc2626;background:#f8fafc;border-radius:0 8px 8px 0;">
            <p style="margin:0 0 4px;font-weight:700;color:#0f172a;">Put Wall</p>
            <p style="margin:0;color:#475569;font-size:14px;">The mirror image — mechanical support.</p>
          </td></tr>
        </table>` +
        p("Want to see today's levels for SPX, SPY, and QQQ — free, updated continuously?") +
        cta(`${SITE.url}/tools/gamma-snapshot`, "See the live snapshot →");
      return { subject, html: emailLayout({ preheader: "Gamma flip, call wall, put wall — the framework in 90 seconds.", bodyHtml: body }) };
    },
  },
  // Day 4 — tool tour.
  {
    step: 3,
    delayDays: 4,
    build: (ctx) => {
      const subject = "Six engines, one desk — a quick tour";
      const engines: [string, string][] = [
        ["SPX Slayer", "The 0DTE desk. Live SPX regime, GEX, and every setup graded A–F."],
        ["Thermal", "GEX, VEX, DEX, and CHARM heatmaps — where dealer hedging accelerates or dampens price."],
        ["HELIX", "Institutional flow scanner — sweeps, blocks, and dark pool prints, filtered to what matters."],
        ["Night Hawk", "The overnight playbook, ready before the bell, plus an intraday 0DTE scanner."],
        ["Largo AI", "Ask it anything about the tape — grounded in live data, not a guess."],
        ["Vector", "Cross-ticker gamma scanner — finds where positioning is setting up the next move."],
      ];
      const list = engines
        .map(
          ([name, desc]) =>
            `<p style="margin:0 0 4px;font-weight:700;color:#0f172a;">${name}</p><p style="margin:0 0 14px;color:#475569;font-size:14px;">${desc}</p>`
        )
        .join("");
      const body = h1(`${greeting(ctx)} here's the whole desk.`) + list + cta(`${SITE.url}/pricing`, "See what's included at each tier →");
      return { subject, html: emailLayout({ preheader: "SPX Slayer, Thermal, HELIX, Night Hawk, Largo, Vector — the full tour.", bodyHtml: body }) };
    },
  },
  // Day 6 — trust/honesty angle (track record itself is member/admin-only, not public — see
  // docs/marketing/SEO-GROWTH.md finding #2; this deliberately does NOT link to a public
  // track-record page, it points at /pricing and /vs/others).
  {
    step: 4,
    delayDays: 6,
    build: (ctx) => {
      const subject = "Every play, graded — no cherry-picking";
      const body =
        h1(`${greeting(ctx)} a word on how we grade.`) +
        p("Every SPX Slayer setup gets a letter grade, A through F, before it ever reaches the screen — and every closed play is logged against that original grade. Wins and losses both. No hindsight edits, no deleted trades.") +
        p("That's a real design decision: if we don't have a verified number, we don't publish one. We'd rather say nothing than make something up — and once you're a member, you see the full graded log live on the desk, not a highlight reel.") +
        cta(`${SITE.url}/vs/others`, "See how that compares →");
      return { subject, html: emailLayout({ preheader: "Wins and losses, both — no cherry-picked highlight reel.", bodyHtml: body }) };
    },
  },
  // Day 8 — direct upgrade CTA.
  {
    step: 5,
    delayDays: 8,
    build: (ctx) => {
      const subject = "Ready to see what the dealers see?";
      const body =
        h1(`${greeting(ctx)} you've got the framework — here's the desk.`) +
        p("SPX Slayer starts at $49/mo — live SPX regime, GEX, and every 0DTE play graded A–F. Premium ($199/mo or $1,999/yr) unlocks all six engines: HELIX, Thermal, Night Hawk, Largo, Vector, and the full graded log.") +
        p("Annual plans carry a 7-day money-back guarantee. Monthly plans: cancel anytime, no contracts.") +
        cta(`${SITE.url}/pricing`, "See the plans →") +
        `<p style="margin:0;color:#64748b;font-size:14px;">Questions before you upgrade? Just reply — a real person reads these. Or drop by <a href="${SITE.social.discord.url}" style="color:#0891b2;text-decoration:none;">Discord</a>, members are happy to talk shop.</p>`;
      return { subject, html: emailLayout({ preheader: "SPX Slayer from $49/mo, Premium from $199/mo — 7-day guarantee on annual.", bodyHtml: body }) };
    },
  },
];
