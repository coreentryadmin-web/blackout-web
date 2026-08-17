import type { BieLevel } from "@/lib/bie/answer-envelope";
import { sanitizeLargoMemberText } from "@/lib/largo/sanitize-member-text";
import { SITE } from "@/lib/site";
import { truncateText } from "@/lib/truncate-text";

const X_CHAR_LIMIT = 280;
const DEFAULT_FOOTER = `@${SITE.social.x.handle}`;

export type LargoXPostInput = {
  answer: string;
  headline?: string | null;
  ticker?: string | null;
  bias?: string | null;
  levels?: BieLevel[];
};

export type LargoXPostDraft = {
  text: string;
  charCount: number;
  intentUrl: string;
  truncated: boolean;
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

function extractVerdictLine(answer: string): string {
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

/** Turn a grounded Largo answer into tweet-length copy (copy-only — no auto-post). */
export function formatLargoXPost(input: LargoXPostInput): LargoXPostDraft {
  const sanitized = sanitizeLargoMemberText(input.answer);
  const headline = input.headline?.trim();
  const ticker = input.ticker?.trim().toUpperCase();
  const verdict = extractVerdictLine(sanitized);
  const levelSnippet = formatLevelSnippet(input.levels);

  let body = headline || verdict;
  if (headline && verdict && headline !== verdict) {
    body = `${headline} — ${verdict}`;
  }
  if (levelSnippet) {
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

  return {
    text,
    charCount: text.length,
    intentUrl,
    truncated,
  };
}
