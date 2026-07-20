import { anthropicText } from "@/lib/providers/anthropic";
import {
  getVectorGexWallsForHorizon,
  getVectorGammaFlipForHorizon,
} from "@/features/vector/lib/vector-snapshot";
import { deriveVectorRegime } from "@/features/vector/lib/vector-regime";
import { getGexPositioning } from "@/lib/providers/gex-positioning";
import type { PostType } from "@/lib/x-content-types";
export type { PostType } from "@/lib/x-content-types";
export {
  selectPostType,
  isPostWindow,
  POST_HOURS_ET,
  SCHEDULE,
} from "@/lib/x-content-schedule";

// ---------------------------------------------------------------------------
// Strategy: 1 product post every 2 hours (8am–8pm ET). Between slots → x-growth
// ---------------------------------------------------------------------------

export interface MarketSnapshot {
  spxPrice?: number;
  regime?: string;
  flipLevel?: number;
  topCallWall?: number;
  topPutWall?: number;
}

export async function fetchMarketSnapshot(): Promise<MarketSnapshot> {
  const snap: MarketSnapshot = {};
  try {
    const [walls, flipLevel, positioning] = await Promise.all([
      getVectorGexWallsForHorizon("SPX", "0dte"),
      getVectorGammaFlipForHorizon("SPX", "0dte"),
      getGexPositioning("SPX").catch(() => null),
    ]);
    const spot = positioning?.spot ?? null;
    if (spot != null) snap.spxPrice = spot;
    if (flipLevel != null) snap.flipLevel = flipLevel;
    snap.topCallWall = walls?.callWalls?.[0]?.strike;
    snap.topPutWall = walls?.putWalls?.[0]?.strike;
    const regime = deriveVectorRegime({
      spot: snap.spxPrice ?? null,
      gammaFlip: snap.flipLevel ?? null,
      topCallWall: snap.topCallWall ?? null,
      topPutWall: snap.topPutWall ?? null,
    });
    snap.regime = regime.read;
  } catch (e) {
    console.warn("[x-autopost] market snapshot failed:", e);
  }
  return snap;
}

export function marketDataReady(
  _postType: PostType,
  data: MarketSnapshot,
): boolean {
  return (
    data.spxPrice != null &&
    data.regime != null &&
    data.regime !== "unknown" &&
    data.flipLevel != null
  );
}

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

export const X_ACCOUNT_USERNAME = "BlackOutTrade";
export const WHOP_URL = "whop.com/blackout-2d9c";
const TAG = `@${X_ACCOUNT_USERNAME}`;

export function xPostFooter(): string {
  return `${TAG} ${WHOP_URL}`;
}

const FULL_STACK = `THE DESK (weave ALL of these naturally — one unified story, not a bullet list):
• Vector — live GEX ladder, animated wall beads, gamma flip line
• Helix — whale options flow tape, premium prints as they hit
• BlackOut Thermal — full GEX/VEX/DEX heatmap matrix across strikes
• Largo — AI terminal, ask any market question, real data answers
• Night Hawk — overnight 0DTE playbook before the bell
• SPX Slayer — 0DTE desk, AI signals, live setups + P&L`;

const PRICING_RULES = `PRICING: Community $75/mo · Premium $199/mo (full desk) · Yearly $1,999/yr. Never say free.`;

const BRAND_VOICE = `You are @BlackOutTrade — the official BlackOut Trades account.

${PRICING_RULES}

${FULL_STACK}

RULES:
- ONE tweet, ONE story — connect live market data to how the full desk works together
- Ask ONE question at the end to drive replies
- Specific SPX levels when provided — never placeholders
- 0-2 emojis max. NO hashtags
- Body under 195 chars (footer added automatically)
- Do NOT include @BlackOutTrade or Whop in body`;

const ANGLES: Record<PostType, string> = {
  desk_open: `ANGLE: Pre-open / morning. Night Hawk dropped overnight levels → Vector shows walls at the bell → SPX Slayer flags the first setup. Paint the morning workflow as one connected desk.`,
  desk_flow: `ANGLE: Flow session. Helix catches a whale print → Thermal matrix shows where dealers are trapped → Vector flip confirms direction. "The tape + the map" story.`,
  desk_ai: `ANGLE: AI-powered desk. Largo answers "where's gamma flip?" while SPX Slayer grades a live 0DTE setup and Vector animates the walls. Intelligence + execution.`,
  desk_matrix: `ANGLE: Data flex. Lead with LIVE SPX level/regime/walls, then show how Thermal matrix + Vector ladder are the same positioning read two ways.`,
  desk_midday: `ANGLE: Mid-session check-in. Full stack working together on the current SPX read — flow (Helix), structure (Vector/Thermal), signals (SPX Slayer), AI (Largo).`,
  desk_close: `ANGLE: Close / recap. Did walls hold? Did flip matter? Tease Night Hawk building tomorrow's playbook while the desk recaps today's P&L story.`,
  desk_evening: `ANGLE: Evening hook — provocative question about trading without the desk vs with all six tools. Make missing out feel painful.`,
  weekend_desk: `ANGLE: Weekend education + desk preview. Teach one gamma/dealer concept, then connect it to Vector + Thermal visualization. Build FOMO for Monday.`,
};

function buildPrompt(type: PostType, d: MarketSnapshot): string {
  const levels =
    d.spxPrice != null
      ? `LIVE SPX: $${Math.round(d.spxPrice)}, regime: ${d.regime}, flip: ${d.flipLevel}, call wall: ${d.topCallWall ?? "—"}, put wall: ${d.topPutWall ?? "—"}`
      : "No live data — write conceptually but stay specific about SPX/0DTE.";

  return `${ANGLES[type]}

${levels}

Write the single best tweet that makes traders want the FULL desk.`;
}

/** Deterministic fallback if Claude unavailable. */
export function fallbackDeskTweet(
  type: PostType,
  d: MarketSnapshot,
): string {
  const spx = d.spxPrice ? `$${Math.round(d.spxPrice)}` : "SPX";
  const flip = d.flipLevel ? `$${d.flipLevel}` : "flip";
  const hooks: Record<PostType, string> = {
    desk_open: `${spx} at open — Night Hawk called the levels, Vector mapped the walls, SPX Slayer flagged the setup. One desk, not six tabs. What's your open plan?`,
    desk_flow: `Helix just lit up on a whale print while Thermal showed dealers pinned at the wall. Vector flip at ${flip} confirms the read. Are you watching flow or guessing?`,
    desk_ai: `Asked Largo where gamma flip is → ${flip}. SPX Slayer graded the 0DTE setup while Vector beads pulsed on the ladder. AI + structure + signals. What's your ticker?`,
    desk_matrix: `${spx}, ${d.regime ?? "negative"} gamma, flip ${flip}. Same positioning read on Thermal matrix + Vector ladder — dealers don't hide. Which lens do you trust?`,
    desk_midday: `Midday: Helix flow + Thermal heatmap + Vector walls + Largo AI + SPX Slayer signals — one connected desk on ${spx}. Trading blind or trading positioned?`,
    desk_close: `Close on ${spx} — did the walls hold? Full desk tracked it live. Night Hawk is already building tomorrow's playbook. Are you on the list?`,
    desk_evening: `Trading 0DTE with charts alone vs Vector walls + Helix flow + Thermal matrix + Largo AI + SPX Slayer + Night Hawk. Which version of you makes money?`,
    weekend_desk: `Weekend truth: gamma flip is where dealer behavior inverts. Vector + Thermal show it live Monday. Are you mapping positioning or trading blind into the open?`,
  };
  return `${hooks[type]}\n${xPostFooter()}`;
}

export async function generateTweetContent(
  postType: PostType,
  data: MarketSnapshot,
): Promise<string | null> {
  try {
    const raw = await anthropicText(buildPrompt(postType, data), 400, BRAND_VOICE, {
      model: "claude-haiku-4-5",
      aiGate: "global",
      temperature: 0.85,
    });
    const body = raw?.trim();
    if (!body) return fallbackDeskTweet(postType, data);
    return `${body}\n${xPostFooter()}`;
  } catch {
    return fallbackDeskTweet(postType, data);
  }
}

// ---------------------------------------------------------------------------
// Images — rotate desk screenshots
// ---------------------------------------------------------------------------

export const MARKETING_IMAGES: Record<string, string> = {
  vector: "public/images/marketing/vector.webp",
  helix: "public/images/marketing/helix.webp",
  thermal: "public/images/marketing/thermal.webp",
  largo: "public/images/marketing/largo.webp",
  hawk: "public/images/marketing/hawk.webp",
  spx: "public/images/marketing/spx.webp",
};

const TYPE_TO_IMAGE: Record<PostType, string> = {
  desk_open: "hawk",
  desk_flow: "helix",
  desk_ai: "largo",
  desk_matrix: "thermal",
  desk_midday: "vector",
  desk_close: "spx",
  desk_evening: "vector",
  weekend_desk: "thermal",
};

export function pickImageKey(postType: PostType): string {
  return TYPE_TO_IMAGE[postType] ?? "vector";
}
