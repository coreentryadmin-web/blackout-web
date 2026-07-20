import { anthropicText } from "@/lib/providers/anthropic";

// ---------------------------------------------------------------------------
// Post types — the engine picks one based on time-of-day + rotation
// ---------------------------------------------------------------------------

export type PostType =
  | "premarket_walls"
  | "market_open"
  | "midday_flow"
  | "close_recap"
  | "feature_showcase"
  | "free_data_drop"
  | "weekend_education"
  | "hot_take"
  | "loss_porn_roast"
  | "after_hours_alpha";

export interface PostSlot {
  type: PostType;
  /** ET hour range [start, end) — inclusive start, exclusive end */
  hours: [number, number];
  /** Days of week (0=Sun..6=Sat). Omit = weekdays only. */
  days?: number[];
}

export const SCHEDULE: PostSlot[] = [
  { type: "premarket_walls", hours: [8, 9] },
  { type: "market_open", hours: [9, 10] },
  { type: "hot_take", hours: [10, 11] },
  { type: "midday_flow", hours: [12, 13] },
  { type: "free_data_drop", hours: [13, 14] },
  { type: "close_recap", hours: [15, 16] },
  { type: "close_recap", hours: [16, 17] },
  { type: "after_hours_alpha", hours: [19, 20] },
  { type: "feature_showcase", hours: [20, 21] },
  { type: "loss_porn_roast", hours: [11, 12] },
  { type: "weekend_education", hours: [10, 12], days: [0, 6] },
  { type: "feature_showcase", hours: [14, 16], days: [0, 6] },
  { type: "hot_take", hours: [18, 19], days: [0, 6] },
];

export function selectPostType(nowEt: Date): PostType | null {
  const h = nowEt.getHours();
  const dow = nowEt.getDay();
  for (const slot of SCHEDULE) {
    const days = slot.days ?? [1, 2, 3, 4, 5];
    if (days.includes(dow) && h >= slot.hours[0] && h < slot.hours[1]) {
      return slot.type;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Market data fetching — calls the app's own endpoints
// ---------------------------------------------------------------------------

interface MarketSnapshot {
  spxPrice?: number;
  spyPrice?: number;
  vixPrice?: number;
  regime?: string;
  flipLevel?: number;
  topCallWall?: number;
  topPutWall?: number;
  maxPain?: number;
}

const APP_BASE =
  process.env.X_AUTOPOST_APP_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "https://blackouttrades.com";

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const url = `${APP_BASE}${path}`;
    const headers: Record<string, string> = {};
    const cronSecret = process.env.CRON_SECRET?.trim();
    if (cronSecret) headers.Authorization = `Bearer ${cronSecret}`;
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchMarketSnapshot(): Promise<MarketSnapshot> {
  const snap: MarketSnapshot = {};

  const [gex, regime] = await Promise.all([
    fetchJson<{
      spot?: number;
      flipLevel?: number;
      topCallWall?: { strike: number };
      topPutWall?: { strike: number };
      maxPain?: number;
    }>("/api/vector/gex-ladder?ticker=SPX&dte=0DTE"),
    fetchJson<{ regime?: string; flipLevel?: number; spot?: number }>(
      "/api/vector/regime?ticker=SPX",
    ),
  ]);

  if (gex) {
    snap.spxPrice = gex.spot;
    snap.flipLevel = gex.flipLevel;
    snap.topCallWall = gex.topCallWall?.strike;
    snap.topPutWall = gex.topPutWall?.strike;
    snap.maxPain = gex.maxPain;
  }
  if (regime) {
    snap.regime = regime.regime;
    snap.flipLevel ??= regime.flipLevel;
    snap.spxPrice ??= regime.spot;
  }
  return snap;
}

// ---------------------------------------------------------------------------
// Content generation via Claude
// ---------------------------------------------------------------------------

const WHOP = "whop.com/blackout-2d9c";
const TAG = "@BlackOutTrade";

/** Appended to every tweet — keep body under limit minus this footer. */
export function xPostFooter(): string {
  return `${TAG} ${WHOP}`;
}

const PRICING_RULES = `MANDATORY PRICING (never violate):
- Community: $75/month (Discord + signals — NOT the full desk)
- Premium Monthly: $199/month (MOST POPULAR — full desk: HELIX, SPX Slayer, Largo, GEX, Thermal, Night Hawk)
- Premium Yearly: $1,999/year (~$167/mo)
- THERE IS NO FREE TIER. NEVER say free, $0, or "no cost." Signup starts at $75/mo.`;

const BRAND_VOICE = `You are @BlackOutTrade on X — the growth voice for BlackOut Trades, the sharpest options-intelligence desk on FinTwit.

${PRICING_RULES}

WHO WE ARE:
Real-time gamma (GEX), dealer walls, whale flow, AI desk signals — institutional weapons for serious traders.

TOOLS (reference naturally):
Vector (gamma walls + regime), Helix (whale flow tape), Thermal (GEX heatmap), Largo (AI analyst), Night Hawk (0DTE playbook), SPX Slayer (live graded 0DTE desk).

VOICE:
- Bold, data-backed, screenshot-worthy. Make traders feel behind if they're not on the desk.
- Provocative questions and hot takes drive replies — ask FinTwit to weigh in.
- Specific strikes, levels, regimes — never vague platitudes.
- 0-2 emojis max. NO hashtags (X algo penalizes spam tags).
- Never corporate. Never "game-changer" or "unlock your potential."
- Create FOMO through specificity and free alpha drops (one level/regime insight, then point to Whop).

FORMAT:
- Write ONLY the tweet body — no quotes.
- Body MUST stay under 200 chars (footer adds ~35 chars).
- Do NOT include @BlackOutTrade or the Whop link — appended automatically.
- End with a punchy line or engagement hook (question > CTA).`;

const STYLE_VARIATIONS = [
  "Write in a BOLD DECLARATIVE style — short punchy statement, then the proof.",
  "Write as a PROVOCATIVE QUESTION that makes traders feel behind — then answer it with what we show.",
  "Write as a MINI STORY — 'Yesterday at 3:47 PM...' type energy. Specific moment, specific data, specific outcome.",
  "Write as a FLEX — casually mention what our members saw before a move happened. Let the results speak.",
  "Write as a ROAST of traders who don't use positioning data — funny but not mean, more 'bro you're trading blind'.",
  "Write as a ONE-LINER ZINGER followed by a single supporting line. Mic-drop energy.",
  "Write as an INSIDE LOOK — 'Here's what our desk is watching right now...' Pull back the curtain.",
  "Write as a PATTERN INTERRUPT — start with something unexpected that stops the scroll, then connect it to our data.",
];

function pickStyle(): string {
  return STYLE_VARIATIONS[Math.floor(Math.random() * STYLE_VARIATIONS.length)];
}

const POST_PROMPTS: Record<PostType, (data: MarketSnapshot) => string> = {
  premarket_walls: (d) => `${pickStyle()}

Write a pre-market tweet that makes traders feel NAKED without this data.
Live data: SPX at ${d.spxPrice ?? "N/A"}, regime: ${d.regime ?? "unknown"},
call wall: ${d.topCallWall ?? "N/A"}, put wall: ${d.topPutWall ?? "N/A"},
flip level: ${d.flipLevel ?? "N/A"}, max pain: ${d.maxPain ?? "N/A"}.

Show them the battlefield before the bell rings. Where are the walls? What does the regime mean?
Make it feel like classified intel that just got declassified. The traders who see this before open
have a massive edge — and they should feel it.`,

  market_open: (d) => `${pickStyle()}

Write a market-open tweet that GIVES AWAY real alpha for free.
Live data: SPX at ${d.spxPrice ?? "N/A"}, regime: ${d.regime ?? "unknown"},
flip level: ${d.flipLevel ?? "N/A"}, top call wall: ${d.topCallWall ?? "N/A"}.

Drop the regime and flip level for free — this is how we hook them. Be generous with one data point
but make it painfully clear there's a whole universe of data behind the paywall. The free data point
should be genuinely useful, not a teaser that feels empty.`,

  hot_take: (d) => `${pickStyle()}

Write a mid-morning hot take that's slightly controversial or surprising.
Live data: SPX at ${d.spxPrice ?? "N/A"}, regime: ${d.regime ?? "unknown"},
flip level: ${d.flipLevel ?? "N/A"}.

This should be the kind of tweet that gets quote-tweeted and debated. Take a strong position on
what's happening in the market right now based on the positioning data. Be specific and confident.
If the regime is negative gamma, lean into the volatility angle. If positive, talk about the pin.
Make people want to argue with you — engagement is the goal.`,

  midday_flow: (d) => `${pickStyle()}

Write a midday update that reads like a war correspondent's dispatch from the trading floor.
Live data: SPX at ${d.spxPrice ?? "N/A"}, regime: ${d.regime ?? "unknown"}.

Reference Helix (our live flow tape) and what unusual activity our members are seeing. Use language
like "the tape just lit up", "massive prints coming through", "someone knows something at the 5,500 strike".
Create urgency — this is happening NOW and you're either watching it or you're not.`,

  close_recap: (d) => `${pickStyle()}

Write an end-of-day recap that makes today's action feel like an episode of a show people need to follow.
Live data: SPX at ${d.spxPrice ?? "N/A"}, regime: ${d.regime ?? "unknown"}.

Frame the day through our data: did the walls hold? Did price respect the flip level? Was the regime
prediction accurate? Tease tomorrow with Night Hawk — our overnight AI playbook that drops before the bell.
Make people feel like they missed the show and need to tune in tomorrow.`,

  free_data_drop: (d) => `${pickStyle()}

Write a "free alpha" tweet that gives away a genuinely useful data point.
Live data: SPX at ${d.spxPrice ?? "N/A"}, regime: ${d.regime ?? "unknown"},
put wall: ${d.topPutWall ?? "N/A"}, call wall: ${d.topCallWall ?? "N/A"},
max pain: ${d.maxPain ?? "N/A"}.

Pick the MOST interesting number and break it down in plain English. What does it mean for a trader?
What's the actionable insight? This should feel like a free sample from a dealer — good enough to get
hooked, leaves you wanting the full supply. Be generous. Real alpha, not vague platitudes.`,

  feature_showcase: () => `${pickStyle()}

Write a tweet that makes ONE of our tools look absolutely insane. Pick randomly:
- Vector: GEX charts with animated wall beads forming/growing/fading in real-time
- Helix: live options flow tape catching whale trades as they happen
- BlackOut Thermal: GEX heatmap matrix showing where dealers are trapped across strikes
- Largo: AI terminal that answers any market question with real data
- Night Hawk: overnight 0DTE playbook published before the bell
- SPX Slayer: 0DTE desk with AI signals, live P&L, tier-graded setups

Describe what it LOOKS like and FEELS like to use it, not just what it does. Make a trader
picture themselves using it and getting an edge they can't get anywhere else. Sensory language —
"watch the beads pulse", "the heatmap goes dark red", "the AI just flagged a setup".`,

  loss_porn_roast: () => `${pickStyle()}

Write a tweet that's a playful roast of traders who trade without positioning data.
Think: "Trading 0DTE without seeing the walls is like driving blindfolded on the highway."
Or: "You really out here buying calls without checking if there's a 50K contract call wall sitting right above you?"
Keep it funny and relatable. Every trader has been there. The punchline is that our tools
would have shown them EXACTLY where the danger was. Not mean-spirited — more like tough love
from a friend who's tired of watching you blow up.`,

  after_hours_alpha: (d) => `${pickStyle()}

Write an after-hours tweet that previews tomorrow's setup.
Live data: SPX closed at ${d.spxPrice ?? "N/A"}, regime: ${d.regime ?? "unknown"},
flip level: ${d.flipLevel ?? "N/A"}.

Reference Night Hawk — our AI overnight playbook. Tease what the positioning data suggests for
tomorrow without giving away the full playbook. Create anticipation. Make traders feel like going
to bed without checking BlackOut is leaving money on the table. Frame it as "while you sleep,
the positioning shifts — Night Hawk catches it all."`,

  weekend_education: () => `${pickStyle()}

Write an educational tweet that teaches ONE concept so clearly that traders screenshot it.
Pick from: gamma exposure (GEX), dealer hedging mechanics, put/call walls as support/resistance,
gamma flip (the line where dealer behavior inverts), max pain (where options expire worthless),
or how market makers create "gravity" at certain strikes.

Make it approachable but smart — don't dumb it down, make it click. Use a concrete example:
"When SPX is above the flip level, dealers buy dips. Below it, they sell into weakness.
That one line on the chart changes EVERYTHING about how the day trades."
End by connecting it to what BlackOut Trades visualizes.`,
};

export async function generateTweetContent(
  postType: PostType,
  data: MarketSnapshot,
): Promise<string | null> {
  const promptFn = POST_PROMPTS[postType];
  if (!promptFn) return null;

  const userPrompt = promptFn(data);

  try {
    const raw = await anthropicText(userPrompt, 400, BRAND_VOICE, {
      model: "claude-haiku-4-5",
      aiGate: "global",
      temperature: 0.9,
    });
    const body = raw?.trim();
    if (!body) return null;
    return `${body}\n${xPostFooter()}`;
  } catch (e) {
    console.error("[x-autopost] Claude content generation failed:", e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Marketing image paths — pre-generated shots for media attachments
// ---------------------------------------------------------------------------

export const MARKETING_IMAGES: Record<string, string> = {
  vector: "public/images/marketing/vector.webp",
  helix: "public/images/marketing/helix.webp",
  thermal: "public/images/marketing/thermal.webp",
  largo: "public/images/marketing/largo.webp",
  hawk: "public/images/marketing/hawk.webp",
  spx: "public/images/marketing/spx.webp",
};

const IMAGE_ROTATION: Record<PostType, string[]> = {
  premarket_walls: ["vector", "thermal", "spx"],
  market_open: ["spx", "vector", "thermal"],
  hot_take: ["vector", "thermal"],
  midday_flow: ["helix", "vector"],
  close_recap: ["spx", "thermal", "vector"],
  free_data_drop: ["vector", "thermal", "helix"],
  feature_showcase: ["vector", "helix", "thermal", "largo", "hawk", "spx"],
  loss_porn_roast: ["spx", "vector", "thermal"],
  after_hours_alpha: ["hawk", "spx", "vector"],
  weekend_education: ["vector", "thermal", "largo"],
};

export function pickImageKey(postType: PostType): string {
  const pool = IMAGE_ROTATION[postType] ?? Object.keys(MARKETING_IMAGES);
  return pool[Math.floor(Math.random() * pool.length)];
}
