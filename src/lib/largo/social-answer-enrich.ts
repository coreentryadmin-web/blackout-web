/**
 * When Largo omits the required ## Post section on social asks, append a grounded skeleton
 * so Copy for X + the operator always get copy + workflow (model still owns the desk read).
 */

import { extractVerdictLine, extractPostCopyFromAnswer } from "@/lib/largo/format-x-post";
import {
  buildPostAngles,
  detectSocialArchetype,
  type SocialContentArchetype,
} from "@/lib/largo/social-content-core";
import { formatMediaPlanForClipboard, buildXPostMediaPlan } from "@/lib/largo/x-post-media-plan";
import { LARGO_PLATFORM_LINKS } from "@/lib/largo/platform-links";

export type SocialPackSlice = {
  available: boolean;
  winners: Array<{ ticker: string; direction: string | null; live_pnl_pct: number | null }>;
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
  return /(?:^|\n)#+\s*Post\b/i.test(answer);
}

export function enrichSocialAnswerIfNeeded(
  answer: string,
  question: string,
  pack: SocialPackSlice | null,
  ticker?: string | null,
): string {
  if (!answer.trim() || hasPostSection(answer)) return answer;
  if (extractPostCopyFromAnswer(answer)) return answer;

  const archetype: SocialContentArchetype = detectSocialArchetype(question);
  const verdict = extractVerdictLine(answer);
  const angles = pack?.available
    ? buildPostAngles(archetype, {
        winners: pack.winners,
        board: pack.board,
        spx: pack.spx,
        record_7d: pack.record_7d,
      })
    : [];

  const attachments = buildXPostMediaPlan({
    answer,
    question,
    ticker,
    archetype,
  });
  const workflow = formatMediaPlanForClipboard(attachments).replace(/^\n+/, "");

  const hook = angles[0] ?? verdict.slice(0, 120);
  const copyLine = verdict.length >= 40 && verdict.length <= 220 ? verdict : hook;

  const block = `
## Post

**Copy**
${copyLine}

**Alt hooks**
- ${angles[1] ?? "What's your line into the close?"}
- ${angles[2] ?? "Desk read first — screenshot proves it."}

**CTA**
Default: @BlackOutTrade · link in bio (${LARGO_PLATFORM_LINKS.pricing}). Discord for live reads: ${LARGO_PLATFORM_LINKS.discord}

**Screenshot workflow**
${workflow}
`.trim();

  return `${answer.trim()}\n\n${block}`;
}
