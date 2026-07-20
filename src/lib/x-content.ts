import { anthropicText } from "@/lib/providers/anthropic";
import {
  getVectorGexWallsForHorizon,
  getVectorGammaFlipForHorizon,
} from "@/features/vector/lib/vector-snapshot";
import { deriveVectorRegime } from "@/features/vector/lib/vector-regime";
import { getGexPositioning } from "@/lib/providers/gex-positioning";
import type { PostType } from "@/lib/x-content-types";
import {
  composeHumanTweet,
  attachFooter,
} from "@/lib/x-content-humanize";
import { xPostFooterLine } from "@/lib/x-whop-link";
import {
  isTooSimilarToRecentPosts,
  dedupRewriteHint,
} from "@/lib/x-content-dedup";
import { getLatestAnalytics } from "@/lib/x-marketing-meta";
import { topPerformingHooks } from "@/lib/x-analytics";
import { recordPostHook } from "@/lib/x-marketing-meta";
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

/** @deprecated use xPostFooterLine(postType) from x-whop-link */
export function xPostFooter(): string {
  return xPostFooterLine();
}

const FULL_STACK = `THE DESK (weave ALL of these naturally — one unified story, not a bullet list):
• Vector — live GEX ladder, animated wall beads, gamma flip line
• Helix — whale options flow tape, premium prints as they hit
• BlackOut Thermal — full GEX/VEX/DEX heatmap matrix across strikes
• Largo — AI terminal, ask any market question, real data answers
• Night Hawk — overnight 0DTE playbook before the bell
• SPX Slayer — 0DTE desk, AI signals, live setups + P&L`;

const PRICING_RULES = `PRICING: Community $75/mo · Premium $199/mo (full desk) · Yearly $1,999/yr. Never say free.`;

const BRAND_VOICE = `You write as a real trader who runs the @BlackOutTrade desk — not a social media manager.

${PRICING_RULES}

Tools you know intimately (mention 2-3 per tweet max, never all six in one line):
Vector (GEX ladder), Helix (flow tape), Thermal (heatmap), Largo (AI), Night Hawk (overnight playbook), SPX Slayer (0DTE signals).

VOICE — sound human:
- Write like you're texting a sharp friend between setups — contractions, rhythm, specificity
- Lead with what matters NOW (a level, a print, a regime shift) then connect to how you read it
- Avoid marketing clichés: no "one desk not six tabs", "full stack", "game-changer", "unlock"
- Avoid listing every product name in a row — that's bot energy
- Ask ONE genuine question traders would actually answer
- NEVER @tag other accounts
- 0-1 emojis. NO hashtags
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

function buildPrompt(
  type: PostType,
  d: MarketSnapshot,
  extraHint = "",
): string {
  const levels =
    d.spxPrice != null
      ? `LIVE SPX: $${Math.round(d.spxPrice)}, regime: ${d.regime}, flip: ${d.flipLevel}, call wall: ${d.topCallWall ?? "—"}, put wall: ${d.topPutWall ?? "—"}`
      : "No live data — write conceptually but stay specific about SPX/0DTE.";

  return `${ANGLES[type]}

${levels}${extraHint}

Write the single best tweet that makes traders want the FULL desk.`;
}

async function performanceHint(): Promise<string> {
  const latest = await getLatestAnalytics();
  if (!latest?.recent_tweets?.length) return "";
  const top = topPerformingHooks(latest, 2);
  if (!top.length) return "";
  return `\n\nPosts that resonated lately (match energy, new angle): ${top.join(" | ")}`;
}

/** Deterministic fallback if Claude unavailable. */
export function fallbackDeskTweet(
  type: PostType,
  d: MarketSnapshot,
): string {
  const spx = d.spxPrice ? `$${Math.round(d.spxPrice)}` : "SPX";
  const flip = d.flipLevel ? `$${d.flipLevel}` : "flip";
  const hooks: Record<PostType, string> = {
    desk_open: `Morning — SPX at ${spx}, flip sitting at ${flip}. Night Hawk had the levels before the bell; Vector's showing where dealers lean. How are you playing the open?`,
    desk_flow: `Helix caught a fat print while Thermal lit up the wall zone. Flip at ${flip} still the line in the sand. You fading or riding flow today?`,
    desk_ai: `Asked Largo where gamma flip is — ${flip}. SPX Slayer flagged a setup while Vector beads moved. What's your conviction level?`,
    desk_matrix: `${spx}, ${d.regime ?? "negative"} gamma, flip ${flip}. Thermal and Vector tell the same story from two angles. Which strike are you watching?`,
    desk_midday: `Midday check: ${spx} holding below flip or reclaiming? Flow's been telling a story on Helix. What's your read into the close?`,
    desk_close: `Closing ${spx} — walls did what walls do. Night Hawk's already sketching tomorrow. Did you trade the positioning or the chart?`,
    desk_evening: `Honest take: charts without dealer gamma is half the picture. We run Vector, Helix, Thermal, Largo, Night Hawk, SPX Slayer for a reason. What's missing from your setup?`,
    weekend_desk: `Weekend thought: gamma flip is where dealer hedging inverts. Come Monday, Vector + Thermal make it visible. Mapping levels or winging it?`,
  };
  return `${hooks[type]}\n${xPostFooterLine(type)}`;
}

export async function generateTweetContent(
  postType: PostType,
  data: MarketSnapshot,
): Promise<{ content: string; draftBody: string; enhanced: boolean } | null> {
  const footer = xPostFooterLine(postType);
  const perfHint = await performanceHint();
  let draftBody = "";
  let extraHint = perfHint;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const raw = await anthropicText(
        buildPrompt(postType, data, extraHint),
        400,
        BRAND_VOICE,
        {
          model: "claude-haiku-4-5",
          aiGate: "global",
          temperature: 0.88,
        },
      );
      draftBody = raw?.trim() ?? "";
    } catch {
      draftBody = "";
    }

    if (!draftBody) break;

    const composed = await composeHumanTweet(draftBody, {
      postType,
      spxPrice: data.spxPrice,
      regime: data.regime,
    });

    const dup = await isTooSimilarToRecentPosts(composed.body);
    if (!dup.similar) {
      return {
        content: attachFooter(composed.body, footer),
        draftBody: composed.draftBody,
        enhanced: composed.enhanced,
      };
    }
    extraHint = perfHint + dedupRewriteHint(dup.matched);
  }

  if (draftBody) {
    const composed = await composeHumanTweet(draftBody, {
      postType,
      spxPrice: data.spxPrice,
      regime: data.regime,
    });
    return {
      content: attachFooter(composed.body, footer),
      draftBody: composed.draftBody,
      enhanced: composed.enhanced,
    };
  }

  return {
    content: fallbackDeskTweet(postType, data),
    draftBody: "(fallback)",
    enhanced: false,
  };
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
