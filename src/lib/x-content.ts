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
  | "weekend_education";

export interface PostSlot {
  type: PostType;
  /** ET hour range [start, end) — inclusive start, exclusive end */
  hours: [number, number];
  /** Days of week (0=Sun..6=Sat). Omit = weekdays only. */
  days?: number[];
}

export const SCHEDULE: PostSlot[] = [
  { type: "premarket_walls", hours: [6, 8] },
  { type: "market_open", hours: [9, 10] },
  { type: "midday_flow", hours: [12, 13] },
  { type: "free_data_drop", hours: [14, 15] },
  { type: "close_recap", hours: [16, 17] },
  { type: "feature_showcase", hours: [19, 20] },
  { type: "weekend_education", hours: [11, 12], days: [0, 6] },
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
  process.env.X_AUTOPOST_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://blackouttrades.com";

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const url = `${APP_BASE}${path}`;
    const headers: Record<string, string> = {};
    const cronSecret = process.env.CRON_SECRET?.trim();
    if (cronSecret) headers.Authorization = `Bearer ${cronSecret}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
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

const BRAND_VOICE = `You are the social media voice of BlackOut Trades — a premium options analytics platform.

VOICE RULES:
- Confident, data-driven, slightly aggressive but never arrogant
- Talk like a sharp trader, not a marketer. No corporate speak.
- Use specific numbers — never vague ("SPX pinned at 5,520 between the 5,500 put wall and 5,550 call wall")
- Short, punchy sentences. One idea per tweet.
- Emojis: use sparingly — max 1-2 per tweet, only when they add energy
- NEVER use hashtags. They look desperate.
- End with a hook that makes non-members curious
- Keep under 270 characters to leave room for an image card
- NO quotation marks around the tweet text
- Write ONLY the tweet text, nothing else`;

const POST_PROMPTS: Record<PostType, (data: MarketSnapshot) => string> = {
  premarket_walls: (d) => `Write a pre-market tweet about SPX options positioning.
Data: SPX at ${d.spxPrice ?? "N/A"}, regime: ${d.regime ?? "unknown"},
call wall: ${d.topCallWall ?? "N/A"}, put wall: ${d.topPutWall ?? "N/A"},
flip level: ${d.flipLevel ?? "N/A"}, max pain: ${d.maxPain ?? "N/A"}.
Angle: tell people where the walls are and what the regime means for today's session.
Make them feel like they're missing out on seeing this data in real-time.`,

  market_open: (d) => `Write a market-open tweet with a free data point.
Data: SPX at ${d.spxPrice ?? "N/A"}, regime: ${d.regime ?? "unknown"},
flip level: ${d.flipLevel ?? "N/A"}, top call wall: ${d.topCallWall ?? "N/A"}.
Give away the regime + flip level for free. Tease that members see walls, max pain,
flow, AI plays, and more — all updating in real-time.`,

  midday_flow: (d) => `Write a midday flow update tweet.
Data: SPX at ${d.spxPrice ?? "N/A"}, regime: ${d.regime ?? "unknown"}.
Talk about how the session is developing relative to the walls. Reference the
Helix flow tape feature. Make traders curious about what unusual flow our members are seeing.`,

  close_recap: (d) => `Write an end-of-day recap tweet.
Data: SPX at ${d.spxPrice ?? "N/A"}, regime: ${d.regime ?? "unknown"}.
Recap how the walls held or broke, how the regime played out.
Tease tomorrow's overnight positioning analysis via Night Hawk.`,

  free_data_drop: (d) => `Write a "free data drop" tweet giving away a specific data point.
Data: SPX at ${d.spxPrice ?? "N/A"}, regime: ${d.regime ?? "unknown"},
put wall: ${d.topPutWall ?? "N/A"}, call wall: ${d.topCallWall ?? "N/A"},
max pain: ${d.maxPain ?? "N/A"}.
Pick the most interesting number and explain what it means in plain English.
End with what else members get access to.`,

  feature_showcase: () => `Write a tweet showcasing a random BlackOut Trades feature.
Pick ONE from: Vector (multi-stock GEX charts with wall beads), Helix (live options flow tape),
BlackOut Thermal (GEX heatmap matrix), Largo (AI analyst terminal), Night Hawk (overnight playbook),
SPX Slayer (0DTE trading desk). Describe what it does in a way that makes a trader NEED to see it.
Focus on the visual — "watch the walls form in real-time" type energy.`,

  weekend_education: () => `Write an educational tweet about options gamma positioning.
Explain one concept clearly: gamma exposure (GEX), dealer positioning, put/call walls,
gamma flip, max pain, or how market makers hedge. Keep it approachable but not dumbed down.
End with how BlackOut Trades makes this visible.`,
};

export async function generateTweetContent(
  postType: PostType,
  data: MarketSnapshot,
): Promise<string | null> {
  const promptFn = POST_PROMPTS[postType];
  if (!promptFn) return null;

  const userPrompt = promptFn(data);

  try {
    const text = await anthropicText(userPrompt, 300, BRAND_VOICE, {
      model: "claude-haiku-4-5",
      aiGate: "global",
    });
    return text?.trim() || null;
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
  premarket_walls: ["vector", "spx"],
  market_open: ["spx", "vector"],
  midday_flow: ["helix", "vector"],
  close_recap: ["spx", "thermal"],
  free_data_drop: ["vector", "thermal", "helix"],
  feature_showcase: ["vector", "helix", "thermal", "largo", "hawk", "spx"],
  weekend_education: ["vector", "thermal"],
};

export function pickImageKey(postType: PostType): string {
  const pool = IMAGE_ROTATION[postType] ?? Object.keys(MARKETING_IMAGES);
  return pool[Math.floor(Math.random() * pool.length)];
}
