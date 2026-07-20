import { anthropicText } from "@/lib/providers/anthropic";
import { isTimelinePostAllowed } from "@/lib/x-feed-policy";

const BOT_PATTERNS = [
  /\bone desk, not six tabs\b/i,
  /\btrading blind or trading positioned\b/i,
  /\bfull stack\b/i,
  /\becosystem\b/i,
  /\bleverage our\b/i,
  /\bunlock\b/i,
  /\bgame-?changer\b/i,
  /\bwhich version of you\b/i,
  /\bare you on the list\b/i,
  /Vector[\s\S]*Helix[\s\S]*Thermal[\s\S]*Largo[\s\S]*SPX Slayer[\s\S]*Night Hawk/i,
  /—.*—.*—/,
  /\?\s*\?/,
];

const HUMAN_OPENERS = [
  "Honest take:",
  "Watching the tape —",
  "Desk read this hour:",
  "Quick gamma check:",
  "Before you size up:",
  "What we're seeing:",
];

/** True if copy reads like generic bot/marketing spam. */
export function soundsLikeBot(body: string): boolean {
  const t = body.trim();
  if (t.length < 20) return true;
  for (const re of BOT_PATTERNS) {
    if (re.test(t)) return true;
  }
  const tools = (t.match(/\b(Vector|Helix|Thermal|Largo|Night Hawk|SPX Slayer)\b/gi) ?? [])
    .length;
  if (tools >= 4) return true;
  return false;
}

function stripFooter(text: string): { body: string; footer: string | null } {
  const idx = text.lastIndexOf("\n@");
  if (idx === -1) return { body: text.trim(), footer: null };
  return { body: text.slice(0, idx).trim(), footer: text.slice(idx + 1).trim() };
}

function trimBody(body: string, maxLen: number): string {
  if (body.length <= maxLen) return body;
  const cut = body.slice(0, maxLen - 1).trimEnd();
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut) + "…";
}

const ENHANCE_SYSTEM = `You polish tweets for @BlackOutTrade — a serious options desk brand.

CRITICAL:
- KEEP every SPX level, regime, flip, wall, and tool reference from the draft
- DO NOT delete facts or product names — ADD human rhythm around them
- Sound like a sharp trader typing between setups, NOT a marketing bot
- Short sentences. Contractions OK. One clear idea.
- ONE question at the end to invite replies
- NO hashtags. NO @tags of other accounts. NO "one desk not six tabs" clichés
- NO listing all 6 tools in one sentence — weave 2-3 max naturally
- Under 195 characters total
- Return ONLY the tweet body (no footer, no quotes)`;

/**
 * Second pass: enhance Claude draft — add human voice, keep substance.
 */
export async function enhanceTweetDraft(
  draftBody: string,
  context: { postType: string; spxPrice?: number; regime?: string },
): Promise<string> {
  const cleaned = draftBody.trim();
  if (!cleaned) return cleaned;

  const userPrompt = `Post slot: ${context.postType}
${context.spxPrice != null ? `SPX: $${Math.round(context.spxPrice)}, regime: ${context.regime ?? "n/a"}` : ""}

DRAFT (keep the data, make it human):
${cleaned}

Rewrite so it performs on X — specific, conversational, worth replying to.`;

  try {
    const enhanced = await anthropicText(userPrompt, 280, ENHANCE_SYSTEM, {
      model: "claude-haiku-4-5",
      aiGate: "global",
      temperature: 0.75,
    });
    const out = enhanced?.trim().replace(/^["']|["']$/g, "");
    if (out && out.length >= 30 && isTimelinePostAllowed(out)) return out;
  } catch {
    /* fall through */
  }

  return deterministicHumanize(cleaned, context);
}

/** Offline polish when AI unavailable — prepend opener, soften bot phrases. */
export function deterministicHumanize(
  body: string,
  context: { postType: string },
): string {
  let t = body
    .replace(/\bone desk, not six tabs\b/gi, "same read, one screen")
    .replace(/\btrading blind or trading positioned\b/gi, "guessing or positioned")
    .replace(/\bfull stack\b/gi, "the desk")
    .replace(/\s+—\s+—\s+/g, " — ")
    .trim();

  if (!/^(Honest|Watching|Desk|Quick|Before|What|SPX|\$)/i.test(t)) {
    const opener =
      HUMAN_OPENERS[context.postType.length % HUMAN_OPENERS.length];
    const candidate = `${opener} ${t}`;
    if (candidate.length <= 195) t = candidate;
  }

  return trimBody(t, 195);
}

export interface ComposedTweet {
  body: string;
  draftBody: string;
  enhanced: boolean;
  botFlagged: boolean;
}

/** Full pipeline: draft → bot check → enhance → trim. */
export async function composeHumanTweet(
  draftBody: string,
  context: { postType: string; spxPrice?: number; regime?: string },
): Promise<ComposedTweet> {
  const botFlagged = soundsLikeBot(draftBody);
  let body = draftBody.trim();

  if (botFlagged || body.split(/[.!?]/).length < 2) {
    body = await enhanceTweetDraft(body, context);
  }

  body = trimBody(body, 195);
  if (soundsLikeBot(body)) {
    body = deterministicHumanize(body, context);
  }

  return {
    body,
    draftBody: draftBody.trim(),
    enhanced: body !== draftBody.trim(),
    botFlagged,
  };
}

export function attachFooter(body: string, footer: string): string {
  return `${body}\n${footer}`;
}

export function splitContentWithFooter(full: string): {
  body: string;
  footerLine: string;
} {
  const { body, footer } = stripFooter(full);
  return { body, footerLine: footer ?? "" };
}
