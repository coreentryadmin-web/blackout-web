/**
 * When Largo omits the required ## Post section on social asks, append a grounded skeleton
 * so Copy for X + the operator always get copy + workflow (model still owns the desk read).
 */

import { extractVerdictLine, extractPostCopyFromAnswer } from "@/lib/largo/format-x-post";
import {
  buildPostAngles,
  detectSocialArchetype,
  type SocialContentArchetype,
  type SocialContentPlayRow,
} from "@/lib/largo/social-content-core";
import { formatMediaPlanForClipboard, buildXPostMediaPlan } from "@/lib/largo/x-post-media-plan";
import { LARGO_PLATFORM_LINKS } from "@/lib/largo/platform-links";
import {
  buildTickerSocialGuide,
  extractSocialPostTicker,
  formatHowToPostBlock,
} from "@/lib/largo/ticker-social-guide";

export type SocialPackSlice = {
  available: boolean;
  winners: SocialContentPlayRow[];
  board: {
    open_count: number;
    closed_today: number;
    best_winner_pct: number | null;
    worst_loser_pct: number | null;
  };
  spx: {
    spot: number | null;
    flip: number | null;
    gamma_regime: string | null;
    conflict: boolean;
  } | null;
  record_7d: {
    wins: number;
    losses: number;
    win_rate_pct: number | null;
    sample_size: number;
  } | null;
};

function hasPostSection(answer: string): boolean {
  return /(?:^|\n)(?:#+\s*Post\b|\*\*Post\*\*)/i.test(answer);
}

function hasTickerProductGuide(answer: string): boolean {
  return /\*\*(?:how to post|products for)\*\*|how to post|products for/i.test(answer);
}

function buildTickerGuideBlock(
  guide: ReturnType<typeof buildTickerSocialGuide>,
  angles: string[],
  verdict: string,
  includeFullPost: boolean,
): string {
  const workflow =
    guide.workflowClipboard ||
    formatMediaPlanForClipboard(guide.essentialAttachments).replace(/^\n+/, "");
  const hook = angles[0] ?? verdict.slice(0, 120);
  const copyLine = verdict.length >= 40 && verdict.length <= 220 ? verdict : hook;

  if (includeFullPost) {
    return `
## Post

**Copy**
${copyLine}

**Alt hooks**
- ${angles[1] ?? "What's your line into the close?"}
- ${angles[2] ?? "Desk read first — screenshot proves it."}

**CTA**
Default: @BlackOutTrade · link in bio (${LARGO_PLATFORM_LINKS.pricing}). Discord for live reads: ${LARGO_PLATFORM_LINKS.discord}

**How to post**
${formatHowToPostBlock()}

**Products for ${guide.ticker}**
${guide.products.map((p) => `- ${p.tool} (${p.essential ? "attach on X" : "optional"}): ${p.why} — capture: ${p.mustCapture.join("; ")}`).join("\n")}

**Screenshot workflow**
${workflow}
`.trim();
  }

  return `
**How to post**
${formatHowToPostBlock()}

**Products for ${guide.ticker}**
${guide.products.map((p) => `- ${p.tool} (${p.essential ? "attach on X" : "optional"}): ${p.why} — capture: ${p.mustCapture.join("; ")}`).join("\n")}

**Screenshot workflow**
${workflow}
`.trim();
}

export function enrichSocialAnswerIfNeeded(
  answer: string,
  question: string,
  pack: SocialPackSlice | null,
  ticker?: string | null,
): string {
  if (!answer.trim()) return answer;

  const archetype: SocialContentArchetype = detectSocialArchetype(question);
  const socialTicker =
    extractSocialPostTicker(question, ticker ?? undefined) ??
    (archetype === "ticker_post" ? ticker ?? null : null);
  const onBoard = pack?.winners.some((w) => w.ticker === socialTicker) ?? false;

  const needsTickerGuide =
    archetype === "ticker_post" &&
    Boolean(socialTicker) &&
    !hasTickerProductGuide(answer);
  const needsPostSection = !extractPostCopyFromAnswer(answer) && !hasPostSection(answer);

  if (!needsTickerGuide && !needsPostSection) return answer;
  if (!socialTicker && needsTickerGuide) return answer;

  const guide = buildTickerSocialGuide({
    ticker: socialTicker ?? ticker ?? "SPX",
    question,
    answer,
    archetype,
    onZerodteBoard: onBoard,
    earningsSoon: /\b(earnings|meridian|catalyst)\b/i.test(question),
  });

  const verdict = extractVerdictLine(answer);
  const angles = pack?.available
    ? buildPostAngles(archetype, {
        winners: pack.winners,
        board: pack.board,
        spx: pack.spx,
        record_7d: pack.record_7d,
      })
    : [];

  const block = buildTickerGuideBlock(guide, angles, verdict, needsPostSection);
  return `${answer.trim()}\n\n${block}`;
}
