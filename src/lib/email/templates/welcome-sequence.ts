import { MEMBERSHIP_PRICING, usd } from "@/lib/pricing";
import { SITE } from "@/lib/site";
import { emailLayout, emailCta, emailHighlight, emailScreenshot, ENGINE_ACCENT, EMAIL_BRAND } from "@/lib/email/layout";
import { spxDeskHeroAsset, thermalKeyLevelsAsset, vectorChartAsset, nighthawkPlaysAsset } from "@/lib/email/inline-assets";
import { marketingUnsubscribe } from "@/lib/email/unsubscribe-token";
import type { EmailAttachment } from "@/lib/email/resend-client";

/** email is required — every step is a marketing-category send and needs it
 *  to build a real one-click unsubscribe link (lib/email/unsubscribe-token.ts). */
export type WelcomeEmailContext = { email: string; firstName?: string | null };
export type WelcomeEmailStep = {
  step: number;
  /** Days after signup this step should send. Step 1 is 0 — sent immediately. */
  delayDays: number;
  build: (ctx: WelcomeEmailContext) => { subject: string; html: string; attachments: EmailAttachment[]; headers: Record<string, string> };
};

/** Substitutes the {{firstName}} token used throughout this file's copy.
 *  "Trader" (capitalized — it doubles as a direct-address nickname, not just
 *  a noun) covers members Clerk didn't capture a first name for. */
function personalize(text: string, ctx: WelcomeEmailContext): string {
  const name = ctx.firstName?.trim() || "Trader";
  return text.replace(/\{\{firstName\}\}/g, name);
}

function h1(text: string): string {
  return `<h1 style="font-size:22px;font-weight:800;margin:0 0 16px;color:${EMAIL_BRAND.ink};line-height:1.3;">${text}</h1>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 18px;color:${EMAIL_BRAND.body};">${text}</p>`;
}

/** Small muted line directly under a screenshot — context for the image, not body copy. */
function caption(html: string): string {
  return `<p style="margin:-10px 0 20px;color:${EMAIL_BRAND.muted};font-size:12px;line-height:1.5;">${html}</p>`;
}

function closing(text: string): string {
  return `<p style="margin:0;color:${EMAIL_BRAND.muted};font-size:14px;">${text}</p>`;
}

export const WELCOME_SEQUENCE: WelcomeEmailStep[] = [
  // Day 0 — orient, one clear first action.
  {
    step: 1,
    delayDays: 0,
    build: (ctx) => {
      const subject = "{{firstName}}, you're in. The desk is live.";
      const heroShot = spxDeskHeroAsset();
      const { url: unsubUrl, headers: unsubHeaders } = marketingUnsubscribe(ctx.email);
      const body =
        h1("Right now, somewhere in this market, a dealer is hedging a bet they never wanted to make.") +
        p(
          "{{firstName}}, that's what actually moves the candle you've been staring at — not vibes, not headlines, a dealer scrambling to hedge exposure they didn't ask for. Most traders only ever see the tick after it happens. You just got access to the mechanics that cause it."
        ) +
        p(
          "Here's what BlackOut actually is: dealer gamma exposure, live institutional options flow, and dark pool prints — GEX by strike, sweep-vs-block flow, size that moved off-tape — fused into one desk. No more juggling six tabs and hoping they agree with each other. This is where the big money leaves footprints, live."
        ) +
        emailScreenshot(heroShot, "The live BlackOut desk — SPX Slayer, gamma map, and Vector chart") +
        p(
          "Six engines live under one login, from the 0DTE grind to the gamma map that shows you exactly where price wants to snap. We're not dumping all six on you today — that full walkthrough is coming. Today's job is simple: get your bearings, fast."
        ) +
        p(
          `Run the fast-start orientation below — five minutes, and the tape looks different for good. Then get into Discord, where members call out setups, break down gamma walls, and argue the tape in real time. Not a newsletter. A floor.`
        ) +
        emailCta(`${SITE.url}/learn/getting-started`, "Get Oriented →") +
        closing("Welcome to the desk, {{firstName}}. The static stops here.");
      const layout = emailLayout({
        preheader: "Dealer gamma. Institutional flow. Dark pool. One screen, no guessing.",
        bodyHtml: personalize(body, ctx),
        unsubscribeUrl: unsubUrl,
      });
      return { subject: personalize(subject, ctx), html: layout.html, attachments: [...layout.attachments, heroShot], headers: unsubHeaders };
    },
  },
  // Day 2 — GEX education, tie to the free tool.
  {
    step: 2,
    delayDays: 2,
    build: (ctx) => {
      const subject = "Three numbers. That's the whole board.";
      const thermalShot = thermalKeyLevelsAsset();
      const { url: unsubUrl, headers: unsubHeaders } = marketingUnsubscribe(ctx.email);
      const body =
        h1("You're not staring at a chart, {{firstName}}. You're staring at a dealer's hedging map.") +
        p(
          "{{firstName}}, two days in — good. Time to stop scrolling past the gamma numbers like they're wallpaper. Every trader staring at SPX today is watching a different movie: most see red and green noise, a coin flip dressed in a suit. You're about to see the skeleton underneath it — the exact structure dealer hedging carves into the tape, every single session. Three levels build that skeleton. Learn them cold and the chart stops lying to you."
        ) +
        emailScreenshot(thermalShot, "Live BlackOut Thermal key levels — gamma flip, call wall, put wall") +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
          ${emailHighlight(
            "Gamma Flip",
            "The line in the sand for the entire session. Above it, dealers sit long gamma — they sell rallies, buy dips, and price gets pinned, tight, boring. Below it, they flip short gamma, and that exact same hedging turns into gasoline on every move instead of a fire blanket. Know which side of this line SPX is standing on before you touch a single ticket today. It changes everything downstream.",
            ENGINE_ACCENT.blue
          )}
          ${emailHighlight(
            "Call Wall",
            "The strike holding the single fattest stack of positive dealer gamma. Price runs at it, stalls, and backs off — like it hit an actual wall. Because it did: dealers short those calls have to sell into every rally just to stay hedged. Not a trendline some guy eyeballed and drew freehand. Resistance, built by math, not vibes.",
            ENGINE_ACCENT.green
          )}
          ${emailHighlight(
            "Put Wall",
            "Same law, flipped. The strike carrying the heaviest negative gamma underneath price — dealers there are forced to buy into weakness just to stay square. Sellers push and push and get stuffed right around there, because the hedging flow beneath them is fighting back. Mechanical support. Not hope, not a bounce. Structure.",
            ENGINE_ACCENT.red
          )}
        </table>` +
        p("Enough theory. The dealers already told you where these lines are today — on SPX, SPY, and QQQ. Live. Free. No login required. Go read the board.") +
        emailCta(`${SITE.url}/tools/gamma-snapshot`, "See Today's Real Levels →") +
        closing("These levels aren't static — they rebuild fresh every session off real positioning. Know where they're sitting before the bell. Everyone else finds out the hard way. — The BlackOut Desk");
      const layout = emailLayout({
        preheader: "Gamma Flip, Call Wall, Put Wall — learn these and the chart stops lying to you.",
        bodyHtml: personalize(body, ctx),
        unsubscribeUrl: unsubUrl,
      });
      return { subject: personalize(subject, ctx), html: layout.html, attachments: [...layout.attachments, thermalShot], headers: unsubHeaders };
    },
  },
  // Day 4 — tool tour.
  {
    step: 3,
    delayDays: 4,
    build: (ctx) => {
      const subject = "The whole desk just lit up, {{firstName}}";
      const engines: [string, string, string][] = [
        [
          "SPX Slayer",
          "The 0DTE desk. Live SPX regime read, live GEX, every setup graded A through F before you know how it plays out. No hindsight edits, no quiet deletions — win or lose, it's logged against the grade it got going in.",
          ENGINE_ACCENT.green,
        ],
        [
          "Thermal",
          "GEX, VEX, DEX, CHARM — mapped and lit up in real time, four forces dealers can't hide from you anymore. See exactly where hedging flow slams the brakes or floors the gas, before price gets there.",
          ENGINE_ACCENT.orange,
        ],
        [
          "HELIX",
          "Sweeps, blocks, dark-pool prints — the footprints big size leaves behind when it thinks nobody's watching. HELIX is always watching, filtered down to what the big desks are actually doing, not the noise around it.",
          ENGINE_ACCENT.purple,
        ],
        [
          "Night Hawk",
          "Your playbook, built overnight while you slept, sitting there ready before the bell rings. Then it doesn't clock out — a live intraday 0DTE scanner keeps running with you the whole session.",
          ENGINE_ACCENT.red,
        ],
        [
          "Largo AI",
          "A trading mind wired straight into the platform's live data. Ask it about a GEX level, a flow print, what a heatmap's actually telling you — it answers off the tape on your screen right now, not a canned guess.",
          ENGINE_ACCENT.blue,
        ],
        [
          "Vector",
          "Cross-ticker gamma scanner, hunting the whole market for where positioning is coiling before the move shows up — not after the headline. Vector doesn't wait for confirmation. It watches the setup get built.",
          ENGINE_ACCENT.teal,
        ],
      ];
      const items = engines.map(([name, desc, accent]) => emailHighlight(name, desc, accent)).join("");
      const vectorShot = vectorChartAsset();
      const { url: unsubUrl, headers: unsubHeaders } = marketingUnsubscribe(ctx.email);
      const body =
        h1("Every light on the board is live, {{firstName}}.") +
        p(
          "Four days ago we handed you the gamma read — the current under the price action nobody else points at. That was one tool. Here's the other five. Six engines, one login, zero dead weight, every instrument built for the hours that actually move your account. No fluff modules nobody opens twice. Just the tape, read straight."
        ) +
        emailScreenshot(vectorShot, "Live Vector chart — dealer gamma structure on SPX") +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">${items}</table>` +
        p("Six engines. Different jobs. Same standard: graded before the outcome, logged either way.") +
        emailCta(`${SITE.url}/pricing`, "See What's Included at Each Tier") +
        closing("The bell's about to ring somewhere. Pick your tier, open the desk, and see the tape the way it actually moves.<br><br>— The BlackOut Trades Desk");
      const layout = emailLayout({
        preheader: "Six engines. One login. Here's every weapon on the floor.",
        bodyHtml: personalize(body, ctx),
        unsubscribeUrl: unsubUrl,
      });
      return { subject: personalize(subject, ctx), html: layout.html, attachments: [...layout.attachments, vectorShot], headers: unsubHeaders };
    },
  },
  // Day 6 — trust/honesty angle (track record itself is member/admin-only, not public — see
  // docs/marketing/SEO-GROWTH.md finding #2; this deliberately does NOT link to a public
  // track-record page, it points at /pricing and /vs/others).
  {
    step: 4,
    delayDays: 6,
    build: (ctx) => {
      const subject = "Graded blind. Logged forever.";
      const nightHawkShot = nighthawkPlaysAsset();
      const { url: unsubUrl, headers: unsubHeaders } = marketingUnsubscribe(ctx.email);
      const body =
        h1("We Grade It Before We Know How It Ends.") +
        p("{{firstName}}, real talk. Every trading account online is a highlight reel. Winners get posted. Losers get quietly deleted. Everybody's a genius by Friday.") +
        p(
          "Not here. Here's the mechanic: every SPX Slayer setup gets graded A through F the second the signal fires — before entry, before the first tick, before anyone on earth knows if it's a winner or a dog. Structure, gamma positioning, flow confirmation — graded on the setup, not the outcome. Then it's locked. Frozen. Nobody touches it again."
        ) +
        p(
          `Then we let the trade breathe. Win. Loss. Breakeven — doesn't matter. It goes in the log right next to the grade it was born with, not the grade we'd wish for after the fact. A setup that stops out sits in the exact same record as one that rips clean. Nothing gets buried. Nothing gets scrubbed. Nothing gets quietly rebranded as "a lesson."`
        ) +
        // Alt text must describe what the image ACTUALLY contains. It previously read "wins and
        // losses both" while the asset showed two red rows and no winner — wrong in both
        // directions at once. The asset is now four real closed/held winners, so the alt says so.
        // The loss-transparency claim lives in the copy and on the record page, which is where a
        // reader can actually verify it; it is not something a single board screenshot can prove.
        emailScreenshot(nightHawkShot, "Live Night Hawk 0DTE board — real graded plays with their entry, exit logic and result") +
        // The board above shows a winning session. Three paragraphs of this email promise that
        // losses are published too, so the image needs a pointer to the place that proves it —
        // otherwise the strongest claim in the sequence rests on a screenshot that happens to be
        // all green, which is precisely the "highlight reel" the copy is arguing against.
        caption(
          `Recent closed plays. The <a href="${SITE.url}/track-record" style="color:${EMAIL_BRAND.muted};">full record</a> — every win and every loss, with the grade each play was given before the outcome — is public.`
        ) +
        p("That's not a tagline — that's the whole build. No revision history, no highlight reel, no do-overs. Go pull up the receipts and see how that holds up against the way everyone else keeps score.") +
        emailCta(`${SITE.url}/vs/others`, "See How We Stack Up") +
        closing("Trade the grade, not the narrative. — The BlackOut Trades Desk");
      const layout = emailLayout({
        preheader: "No hindsight edits. No deleted losers. Every SPX Slayer call is on the tape — win or lose, go check it yourself.",
        bodyHtml: personalize(body, ctx),
        unsubscribeUrl: unsubUrl,
      });
      return { subject: personalize(subject, ctx), html: layout.html, attachments: [...layout.attachments, nightHawkShot], headers: unsubHeaders };
    },
  },
  // Day 8 — direct upgrade CTA.
  {
    step: 5,
    delayDays: 8,
    build: (ctx) => {
      const subject = "{{firstName}}, eight days of watching is enough.";
      const { url: unsubUrl, headers: unsubHeaders } = marketingUnsubscribe(ctx.email);
      const body =
        h1("The Bell Hasn't Rung. The Story Already Has.") +
        p(
          "Eight days ago you walked onto the floor, {{firstName}}. Since then you've watched us call a regime and grade a setup A through F before a single candle confirms anything — then show you exactly how it landed. Win or lose. Losses sit right next to wins, untouched, un-hidden. No quiet deletes, no highlight reel dressed up as a track record. That's not marketing. That's the whole book, open, every single day."
        ) +
        p(
          "Here's the structure, plain: SPX Slayer — the 0DTE desk, live SPX regime read, GEX, every setup graded before anyone knows if it wins — starts at ${usd(MEMBERSHIP_PRICING.community)}/mo. Want the full terminal? Premium unlocks all six engines: SPX Slayer, Thermal's GEX/VEX/DEX/CHARM heatmaps, HELIX flagging sweeps and dark-pool prints, Night Hawk's pre-bell playbook, Largo AI riding the live data, Vector hunting the next squeeze before it runs. ${usd(MEMBERSHIP_PRICING.monthly)}/mo, or ${usd(MEMBERSHIP_PRICING.yearly)}/yr if you're all-in — annual carries a 7-day money-back guarantee. Monthly cancels anytime. No contract, no hooks in you."
        ) +
        p(
          "We're not asking you to trust a highlight reel. Every grade we issue gets marked to market — wins post, losses post, same ticker, same grade, logged before the candle closes and never touched after. That's the edge. The desk doesn't wait around for you to catch up."
        ) +
        emailCta(`${SITE.url}/pricing`, "Get On the Desk") +
        closing(
          `Questions before you pull the trigger? Hit reply — a real trader reads this inbox, not a bot. Or come argue gamma flips with the rest of the desk in <a href="${SITE.social.discord.url}" style="color:${EMAIL_BRAND.limeText};font-weight:600;text-decoration:none;">Discord</a>. See you out there.`
        );
      const layout = emailLayout({
        preheader: "Every grade posted before the outcome. Every loss still on the tape. The desk is open.",
        bodyHtml: personalize(body, ctx),
        unsubscribeUrl: unsubUrl,
      });
      return { subject: personalize(subject, ctx), html: layout.html, attachments: layout.attachments, headers: unsubHeaders };
    },
  },
];
