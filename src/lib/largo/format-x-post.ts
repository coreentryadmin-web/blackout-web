import type { BieLevel } from "@/lib/bie/answer-envelope";
import { sanitizeLargoMemberText } from "@/lib/largo/sanitize-member-text";
import type { SocialContentArchetype } from "@/lib/largo/social-content-core";
import {
  buildXPostMediaPlan,
  formatMediaPlanForClipboard,
  type XPostMediaAttachment,
} from "@/lib/largo/x-post-media-plan";
import { SITE } from "@/lib/site";
import { truncateText } from "@/lib/truncate-text";
import { extractSocialPostTicker } from "@/lib/largo/ticker-social-guide";

const X_CHAR_LIMIT = 280;
const DEFAULT_FOOTER = `@${SITE.social.x.handle}`;

export type LargoXPostInput = {
  answer: string;
  headline?: string | null;
  ticker?: string | null;
  bias?: string | null;
  levels?: BieLevel[];
  question?: string | null;
  archetype?: SocialContentArchetype | null;
};

export type LargoXPostDraft = {
  text: string;
  charCount: number;
  intentUrl: string;
  truncated: boolean;
  attachments: XPostMediaAttachment[];
  /** Tweet copy + numbered attachment checklist (for clipboard). */
  clipboardText: string;
  archetype: SocialContentArchetype;
  altHooks: string[];
};

/** Strip markdown structures unsuitable for a tweet. */
export function stripMarkdownForTweet(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\n{2,}/g, " ")
    .replace(/\n/g, " ")
    .replace(/[^\S ]+/g, " ")
    .trim();
}

export function extractVerdictLine(answer: string): string {
  const verdictMatch = answer.match(/(?:^|\n)#+\s*Verdict\s*\n+([^\n#]+)/i);
  if (verdictMatch?.[1]) return verdictMatch[1].trim();

  const lines = answer
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (/^#+\s/.test(line)) continue;
    if (/^verdict\b/i.test(line)) continue;
    const cleaned = stripMarkdownForTweet(line);
    if (cleaned.length >= 20) return cleaned;
  }
  return stripMarkdownForTweet(lines[0] ?? "");
}

function formatLevelSnippet(levels?: BieLevel[]): string {
  if (!levels?.length) return "";
  const parts = levels.slice(0, 2).map((l) => {
    const label = String(l.label ?? "").trim();
    const price =
      l.price != null && Number.isFinite(l.price)
        ? `$${Math.round(l.price)}`
        : "";
    if (label && price) return `${label} ${price}`;
    return label || price;
  }).filter(Boolean);
  return parts.join(" · ");
}

function extractPostSection(answer: string): string | null {
  const m = answer.match(
    /(?:^|\n)(?:#+\s*Post\b|\*\*Post\*\*)\s*\n([\s\S]*?)(?=\n##\s|\n\*\*Verdict\*\*|$)/i,
  );
  return m?.[1]?.trim() ?? null;
}

/** Prefer Largo-authored **Copy** from the Post section when present. */
export function extractPostCopyFromAnswer(answer: string): string | null {
  const section = extractPostSection(answer);
  if (!section) return null;
  const copyMatch = section.match(
    /\*\*Copy\*\*\s*[:\-]?\s*\n?([\s\S]*?)(?=\n\*\*Alt hooks?\*\*|\n\*\*Attach\*\*|$)/i,
  );
  const raw = copyMatch?.[1]?.trim();
  if (!raw) return null;
  const line = stripMarkdownForTweet(raw.split("\n").find((l) => l.trim()) ?? raw);
  return line.length >= 15 ? line : null;
}

export function extractAltHooksFromAnswer(answer: string): string[] {
  const section = extractPostSection(answer);
  if (!section) return [];
  const block = section.match(
    /\*\*Alt hooks?\*\*\s*[:\-]?\s*\n?([\s\S]*?)(?=\n\*\*Attach\*\*|$)/i,
  )?.[1];
  if (!block) return [];
  return block
    .split("\n")
    .map((l) => stripMarkdownForTweet(l.replace(/^[-*]\s*/, "")))
    .filter((l) => l.length >= 15)
    .slice(0, 3);
}

/** Turn a grounded Largo answer into tweet-length copy (copy-only — no auto-post). */
export function formatLargoXPost(input: LargoXPostInput): LargoXPostDraft {
  const sanitized = sanitizeLargoMemberText(input.answer);
  const headline = input.headline?.trim();
  const ticker =
    input.ticker?.trim().toUpperCase() ??
    extractSocialPostTicker(input.question ?? "", input.ticker) ??
    undefined;
  const authoredCopy = extractPostCopyFromAnswer(sanitized);
  const verdict = extractVerdictLine(sanitized);
  const levelSnippet = formatLevelSnippet(input.levels);
  const altHooks = extractAltHooksFromAnswer(sanitized);

  let body = authoredCopy || headline || verdict;
  if (headline && verdict && headline !== verdict) {
    body = `${headline} — ${verdict}`;
  }
  if (levelSnippet && !authoredCopy) {
    body = `${body} (${levelSnippet})`;
  }
  if (ticker && !body.toUpperCase().includes(ticker)) {
    body = `${ticker}: ${body}`;
  }

  body = stripMarkdownForTweet(body);
  body = body.replace(/#\w+/g, "").replace(/@\w{2,}/g, "").trim();

  const footer = `\n${DEFAULT_FOOTER}`;
  const maxBody = X_CHAR_LIMIT - footer.length;
  let truncated = false;
  if (body.length > maxBody) {
    body = truncateText(body, maxBody);
    truncated = true;
  }

  const text = `${body}${footer}`;
  const intentUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
  const attachments = buildXPostMediaPlan({
    ticker,
    answer: sanitized,
    question: input.question,
    archetype: input.archetype ?? undefined,
  });
  const altBlock =
    altHooks.length > 0
      ? `\n\nAlt hooks:\n${altHooks.map((h, i) => `${i + 1}. ${h}`).join("\n")}`
      : "";
  const clipboardText = `${text}${altBlock}${formatMediaPlanForClipboard(attachments)}`;

  return {
    text,
    charCount: text.length,
    intentUrl,
    truncated,
    attachments,
    clipboardText,
    archetype: input.archetype ?? "live_desk",
    altHooks,
  };
}
