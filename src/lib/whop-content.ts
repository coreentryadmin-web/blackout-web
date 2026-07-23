import { anthropicText } from "@/lib/providers/anthropic";
import {
  getVectorGexWallsForHorizon,
  getVectorGammaFlipForHorizon,
} from "@/features/vector/lib/vector-snapshot";
import { deriveVectorRegime } from "@/features/vector/lib/vector-regime";
import { getGexPositioning } from "@/lib/providers/gex-positioning";

// ---------------------------------------------------------------------------
// Post types — each maps to a content generator + visibility + schedule slot
// ---------------------------------------------------------------------------

export const WHOP_POST_TYPES = [
  "nighthawk_playbook",
  "nighthawk_proof",
  "morning_regime",
  "daily_recap",
  "product_vector",
  "product_helix",
  "product_nighthawk",
  "product_spxslayer",
  "product_largo",
  "product_thermal",
  "weekly_recap",
  "platform_intro",
] as const;

export type WhopPostType = (typeof WHOP_POST_TYPES)[number];

export type WhopContentResult = {
  title: string;
  content: string;
  visibility: "public" | "members_only";
};

// ---------------------------------------------------------------------------
// Market snapshot (shared with x-content, kept lean)
// ---------------------------------------------------------------------------

interface MarketContext {
  spxPrice?: number;
  regime?: string;
  flipLevel?: number;
  topCallWall?: number;
  topPutWall?: number;
}

export async function fetchMarketContext(): Promise<MarketContext> {
  const ctx: MarketContext = {};
  try {
    const [walls, flipLevel, positioning] = await Promise.all([
      getVectorGexWallsForHorizon("SPX", "0dte"),
      getVectorGammaFlipForHorizon("SPX", "0dte"),
      getGexPositioning("SPX").catch(() => null),
    ]);
    if (positioning?.spot != null) ctx.spxPrice = positioning.spot;
    if (flipLevel != null) ctx.flipLevel = flipLevel;
    ctx.topCallWall = walls?.callWalls?.[0]?.strike;
    ctx.topPutWall = walls?.putWalls?.[0]?.strike;
    const regime = deriveVectorRegime({
      spot: ctx.spxPrice ?? null,
      gammaFlip: ctx.flipLevel ?? null,
      topCallWall: ctx.topCallWall ?? null,
      topPutWall: ctx.topPutWall ?? null,
    });
    ctx.regime = regime.read;
  } catch (e) {
    console.warn("[whop-content] market context failed:", e);
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Schedule: which post type runs at which ET hour
// ---------------------------------------------------------------------------

type ScheduleSlot = { hour: number; type: WhopPostType; weekdaysOnly?: boolean };

const PRODUCT_ROTATION: WhopPostType[] = [
  "product_vector",
  "product_helix",
  "product_nighthawk",
  "product_spxslayer",
  "product_largo",
  "product_thermal",
];

export function todaysProductSpotlight(): WhopPostType {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000,
  );
  return PRODUCT_ROTATION[dayOfYear % PRODUCT_ROTATION.length];
}

export const WHOP_SCHEDULE: ScheduleSlot[] = [
  { hour: 8, type: "morning_regime", weekdaysOnly: true },
  { hour: 12, type: "platform_intro" },
  { hour: 16, type: "daily_recap", weekdaysOnly: true },
  { hour: 19, type: "nighthawk_playbook", weekdaysOnly: true },
];

export function selectWhopPostType(et: Date): WhopPostType | null {
  const hour = et.getHours();
  const min = et.getMinutes();
  const dow = et.getDay();
  const isWeekday = dow >= 1 && dow <= 5;

  // Check scheduled slots — 30-minute window around the target hour
  for (const slot of WHOP_SCHEDULE) {
    if (slot.weekdaysOnly && !isWeekday) continue;
    if (hour === slot.hour && min < 30) return slot.type;
  }

  // Product spotlight at 10am ET on weekdays
  if (isWeekday && hour === 10 && min < 30) return todaysProductSpotlight();

  // Weekly recap — Sunday 6pm ET
  if (dow === 0 && hour === 18 && min < 30) return "weekly_recap";

  return null;
}

// ---------------------------------------------------------------------------
// Brand voice for Whop (longer-form than X — Whop supports Markdown)
// ---------------------------------------------------------------------------

const WHOP_BRAND_VOICE = `You are the @BlackOutTrade content engine writing for the Whop storefront.

These posts appear on the PUBLIC Whop profile — anyone browsing can see them.
Goal: make traders want to join the community and subscribe.

TONE:
- Confident, specific, data-driven — never generic marketing fluff
- Write like a trader who runs a desk, not a social media manager
- Use real numbers, real levels, real trade examples
- Markdown formatting: bold for emphasis, bullet points for lists
- 150-400 words (Whop posts can be longer than tweets)
- End with a clear CTA: "Join the desk →" or "See tonight's plays →"
- NEVER use hashtags
- 0-1 emojis max

PRODUCTS (reference 2-3 per post, never list all six):
- **Vector** — live GEX ladder, animated wall beads, gamma flip line, regime detection
- **Helix** — whale options flow tape, premium prints, strike stacks
- **BlackOut Thermal** — full GEX/VEX/DEX heatmap matrix across strikes
- **Largo** — AI terminal, ask any market question, gets real data answers
- **Night Hawk** — overnight playbook with entries, targets, stops delivered before the bell
- **SPX Slayer** — 0DTE desk, AI signals, live setups + P&L tracking

PRICING: Community $75/mo · Premium $199/mo (full desk) · Yearly $1,999/yr`;

// ---------------------------------------------------------------------------
// Content generators per post type
// ---------------------------------------------------------------------------

const PROMPTS: Record<WhopPostType, (ctx: MarketContext) => string> = {
  nighthawk_playbook: (ctx) => `Write a Whop post announcing that tonight's Night Hawk playbook just dropped.
${marketLine(ctx)}
Tease the TYPES of plays loaded (e.g. "3 swing setups across tech and energy") but do NOT reveal specific tickers, strikes, or entries — those are members-only.
Mention that entries, targets, and stops are all mapped out before the bell.
CTA: join to see the full playbook.`,

  nighthawk_proof: (ctx) => `Write a Whop post celebrating a Night Hawk play that hit its target.
${marketLine(ctx)}
Frame it as proof that the system works — overnight analysis, precise entry, target reached.
Don't fabricate specific numbers — write it as a template: "[TICKER] hit target for +X%" and note this is the kind of result the playbook delivers consistently.
CTA: see the track record and tonight's new plays.`,

  morning_regime: (ctx) => `Write a morning market brief for Whop.
${marketLine(ctx)}
Cover: the gamma regime (positive/negative and what it means for price action), key GEX walls, the flip level, and what the desk is watching.
Show that BlackOut reads the market through dealer positioning, not just charts.
CTA: the full desk is live — Vector, Helix, SPX Slayer all running.`,

  daily_recap: (ctx) => `Write an end-of-day recap for Whop.
${marketLine(ctx)}
Recap the session: did walls hold? Did the flip matter? How did flow confirm or deny the morning read?
Frame it as "this is what having a real desk looks like" — the tools called the session before it happened.
CTA: tomorrow's Night Hawk playbook drops tonight.`,

  product_vector: (ctx) => `Write a Whop product spotlight on **Vector**.
${marketLine(ctx)}
Vector is the real-time GEX visualization tool: animated wall beads that show where dealers are positioned, a gamma flip line that marks the inversion point, a full strike ladder, and regime detection.
Explain what it does in TRADER terms — not feature lists. How does a trader USE Vector to make better entries?
CTA: see Vector in action on the desk.`,

  product_helix: (ctx) => `Write a Whop product spotlight on **Helix**.
${marketLine(ctx)}
Helix is the whale options flow tape: real-time premium prints, strike stack detection (when big money hammers the same strike repeatedly), net premium leaderboard, and flow scoring.
Explain how a trader uses Helix to see what smart money is doing before price moves.
CTA: watch the tape live.`,

  product_nighthawk: (ctx) => `Write a Whop product spotlight on **Night Hawk**.
${marketLine(ctx)}
Night Hawk is the overnight playbook engine: after the close, it scans flow, technicals, GEX positioning, news, and earnings data to generate ranked plays with exact entries, targets, and stops — delivered before the bell rings.
Morning confirmation checks each play against pre-market data and pulls any that invalidated overnight.
Explain the value: you wake up with a game plan, not a blank screen.
CTA: see tonight's playbook.`,

  product_spxslayer: (ctx) => `Write a Whop product spotlight on **SPX Slayer**.
${marketLine(ctx)}
SPX Slayer is the 0DTE command desk: AI-generated signals based on flow + GEX + technicals, live setup tracking with entry/target/stop, real-time P&L, and the Cortex engine that synthesizes all evidence into one conviction read.
Explain how it takes the chaos of 0DTE and turns it into structured, graded setups.
CTA: run 0DTE with an edge.`,

  product_largo: (ctx) => `Write a Whop product spotlight on **Largo**.
${marketLine(ctx)}
Largo is the AI terminal: ask any market question in plain English and get a data-backed answer. It pulls from GEX positioning, options flow, dark pool prints, technicals, fundamentals, news, earnings, and the full BlackOut tool suite.
"Where's gamma flip on SPX?" → real answer with the number, not a chatbot guess.
CTA: ask Largo anything.`,

  product_thermal: (ctx) => `Write a Whop product spotlight on **BlackOut Thermal**.
${marketLine(ctx)}
Thermal is the GEX heatmap matrix: a visual map of dealer gamma exposure across every strike and expiry. It shows where dealers are most concentrated, where hedging pressure builds, and how the positioning surface shifts intraday.
Think of it as the X-ray of the options market — you see the structure behind the price.
CTA: see the matrix.`,

  weekly_recap: (ctx) => `Write a weekly recap for Whop — a summary of the week's performance.
${marketLine(ctx)}
Cover: how many Night Hawk plays hit, notable wins, how the desk read the week's sessions (regime calls, wall holds, flow confirmations).
Frame it as consistency — this is what happens week after week when you trade with a real positioning desk.
CTA: join for next week's playbooks.`,

  platform_intro: (_ctx) => `Write a "What is BlackOut?" intro post for Whop.
This is for people who just landed on the profile and have no idea what BlackOut Trades is.
Cover: the 6 tools (briefly), who it's for (options traders who want precision, not motivation), what makes it different (real data, real entries, real targets — not generic alerts).
Pricing: Community $75/mo, Premium $199/mo (full desk), Yearly $1,999/yr.
CTA: check out the desk.`,
};

function marketLine(ctx: MarketContext): string {
  if (ctx.spxPrice == null) return "No live market data available — write conceptually.";
  return `LIVE: SPX $${Math.round(ctx.spxPrice)}, regime: ${ctx.regime ?? "unknown"}, flip: ${ctx.flipLevel ?? "—"}, call wall: ${ctx.topCallWall ?? "—"}, put wall: ${ctx.topPutWall ?? "—"}`;
}

// ---------------------------------------------------------------------------
// Generate content for a given post type
// ---------------------------------------------------------------------------

export async function generateWhopContent(
  postType: WhopPostType,
  ctx: MarketContext,
): Promise<WhopContentResult | null> {
  const prompt = PROMPTS[postType](ctx);
  const isProduct =
    postType.startsWith("product_") ||
    postType === "platform_intro" ||
    postType === "weekly_recap";

  try {
    const raw = await anthropicText(prompt, 800, WHOP_BRAND_VOICE, {
      model: "claude-haiku-4-5",
      aiGate: "global",
      temperature: 0.8,
    });

    if (!raw?.trim()) return null;

    const title = deriveTitle(postType, ctx);
    const content = raw.trim();

    return {
      title,
      content,
      visibility: isProduct ? "public" : postType === "nighthawk_playbook" ? "public" : "public",
    };
  } catch (err) {
    console.error("[whop-content] generation failed:", err);
    return null;
  }
}

function deriveTitle(postType: WhopPostType, ctx: MarketContext): string {
  const spx = ctx.spxPrice ? `SPX $${Math.round(ctx.spxPrice)}` : "";
  const titles: Record<WhopPostType, string> = {
    nighthawk_playbook: "Tonight's Night Hawk Playbook Is Live",
    nighthawk_proof: "Night Hawk Target Hit",
    morning_regime: spx ? `Morning Brief — ${spx}` : "Morning Market Brief",
    daily_recap: spx ? `Session Recap — ${spx}` : "End of Day Recap",
    product_vector: "Vector — Real-Time GEX Visualization",
    product_helix: "Helix — Whale Options Flow Tape",
    product_nighthawk: "Night Hawk — Your Overnight Trading Edge",
    product_spxslayer: "SPX Slayer — 0DTE Command Desk",
    product_largo: "Largo — AI Trading Terminal",
    product_thermal: "BlackOut Thermal — GEX Heatmap Matrix",
    weekly_recap: "Weekly Recap — The Desk Delivered",
    platform_intro: "What Is BlackOut Trades?",
  };
  return titles[postType];
}

// ---------------------------------------------------------------------------
// Fallback static content (when AI generation unavailable)
// ---------------------------------------------------------------------------

export function fallbackWhopContent(
  postType: WhopPostType,
  ctx: MarketContext,
): WhopContentResult {
  const spx = ctx.spxPrice ? `$${Math.round(ctx.spxPrice)}` : "SPX";

  const fallbacks: Record<WhopPostType, string> = {
    nighthawk_playbook: `Tonight's playbook just dropped. Entries, targets, stops — all mapped out before the bell.\n\nNight Hawk scans flow, GEX positioning, technicals, and catalysts overnight so you wake up with a game plan.\n\n**Join to see the full playbook →**`,
    nighthawk_proof: `Another Night Hawk target hit. The overnight analysis called it, the entry was precise, and the target was reached.\n\nThis is what consistency looks like when you trade with real data.\n\n**See the track record →**`,
    morning_regime: `Morning — SPX at ${spx}.\n\nThe desk is reading dealer positioning through Vector, tracking flow on Helix, and SPX Slayer is scanning for the first 0DTE setup.\n\n**The full desk is live →**`,
    daily_recap: `Session closed. The walls, the flip, the flow — the desk read it before it happened.\n\n**Tomorrow's Night Hawk playbook drops tonight →**`,
    product_vector: `**Vector** shows you where dealers are positioned — in real time.\n\nAnimated wall beads, gamma flip line, strike ladder, regime detection. Not a chart indicator. The actual GEX structure behind price.\n\n**See Vector on the desk →**`,
    product_helix: `**Helix** is the whale tape.\n\nEvery premium print, every strike stack, every flow signal — as it happens. When smart money hammers a strike, you see it before price reacts.\n\n**Watch the tape live →**`,
    product_nighthawk: `**Night Hawk** builds your playbook while you sleep.\n\nAfter the close, it scans everything — flow, GEX, technicals, news, earnings — and delivers ranked plays with exact entries, targets, and stops before the bell.\n\nMorning confirmation pulls any play that invalidated overnight.\n\n**See tonight's playbook →**`,
    product_spxslayer: `**SPX Slayer** is the 0DTE command desk.\n\nAI signals from flow + GEX + technicals. Live setup tracking with entry/target/stop. Real-time P&L. The Cortex engine synthesizes all evidence into one conviction read.\n\n**Run 0DTE with an edge →**`,
    product_largo: `**Largo** answers any market question with real data.\n\n"Where's gamma flip on SPX?" → the actual number, pulled from live GEX positioning.\n"Is NVDA flow bullish today?" → real flow data, not a guess.\n\n**Ask Largo anything →**`,
    product_thermal: `**BlackOut Thermal** is the X-ray of the options market.\n\nA GEX heatmap matrix across every strike and expiry. See where dealers are concentrated, where hedging pressure builds, and how the surface shifts intraday.\n\n**See the matrix →**`,
    weekly_recap: `Another week on the desk. Night Hawk delivered plays, Vector read the walls, and the flow confirmed.\n\nConsistency is the edge. Join for next week's playbooks.\n\n**See the desk →**`,
    platform_intro: `**BlackOut Trades** is a real-time options trading desk.\n\n6 tools built for traders who want precision:\n- **Vector** — GEX ladder + wall beads + regime\n- **Helix** — whale flow tape + strike stacks\n- **Thermal** — GEX heatmap matrix\n- **Night Hawk** — overnight playbook (entries, targets, stops)\n- **SPX Slayer** — 0DTE command desk + AI signals\n- **Largo** — AI terminal (ask anything, get data)\n\nCommunity $75/mo · Premium $199/mo · Yearly $1,999/yr\n\n**Check out the desk →**`,
  };

  return {
    title: deriveTitle(postType, ctx),
    content: fallbacks[postType],
    visibility: "public",
  };
}
