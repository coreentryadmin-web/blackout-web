/**
 * Institutional tone for Largo/BIE member-facing markdown — no emoji, no casual hedging
 * that implies fabricated data. Applied on deterministic compose paths only.
 */

const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;

const CASUAL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bgonna\b/gi, "going to"],
  [/\bgonna rip or dip\b/gi, "rally or sell off"],
  [/\brip or dip\b/gi, "rally or sell off"],
  [/\blotta\b/gi, "a lot of"],
  [/\byeah\b/gi, "yes"],
  [/\bnope\b/gi, "no"],
];

/** Strip emoji and casual phrasing from a composed answer string. */
export function toProfessionalMarkdown(text: string): string {
  let out = text.replace(EMOJI_RE, "").replace(/\s{2,}/g, " ");
  for (const [re, rep] of CASUAL_REPLACEMENTS) {
    out = out.replace(re, rep);
  }
  return out
    .split("\n")
    .map((l) => l.replace(/\s{2,}/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Overconfidence phrases, and the NEGATION that makes them responsible instead.
 *
 * MEASURED FALSE POSITIVE 2026-08-11. The old check was a bare word match on
 * `guarantee|sure thing|can't lose|free money|100% win`, and the one answer it flagged in a live
 * production sweep said:
 *
 *   "conviction in the tape does not guarantee execution"
 *
 * That is a caution — the exact copy this check exists to encourage — scored as its opposite. The
 * word carries no tone on its own; the negation in front of it does. And the failure is not
 * symmetric: a false positive here pushes the answer layer to DELETE hedging language in order to
 * score well, which makes members' copy more confident, not less. A tone check that penalises
 * caution is worse than no tone check.
 *
 * So a match is suppressed when it is negated within the ~24 characters before it — enough for
 * "does not ", "is no ", "cannot ", "never ", "there are no ", "without any ".
 */
const OVERCONFIDENT_RE = /\b(guarantees?|guaranteed|sure thing|can't lose|cannot lose|free money|100% win)\b/gi;

/** Negation immediately preceding a hit, e.g. "does not guarantee", "no sure thing". */
const NEGATED_BEFORE_RE = /\b(not|never|no|none|cannot|can't|without|nothing|isn't|aren't|doesn't|don't)\b[^.;]{0,24}$/i;

/** The overconfident phrases in `answer` that are NOT negated. Exported so a caller can report which. */
export function overconfidentClaims(answer: string): string[] {
  const out: string[] = [];
  for (const m of answer.matchAll(OVERCONFIDENT_RE)) {
    const before = answer.slice(Math.max(0, m.index - 40), m.index);
    if (NEGATED_BEFORE_RE.test(before)) continue;
    out.push(m[0]);
  }
  return out;
}

/** Scoring heuristics for stress harnesses — flags unprofessional or speculative copy. */
export function toneIssues(answer: string): string[] {
  const issues: string[] = [];
  if (EMOJI_RE.test(answer)) issues.push("emoji");
  if (/\b(i think|i believe|probably|maybe|might be|could be around|approximately)\b/i.test(answer)) {
    issues.push("speculative");
  }
  if (overconfidentClaims(answer).length > 0) issues.push("overconfident");
  if (/\?\?\?|\!\!\!/.test(answer)) issues.push("casual-punctuation");
  return issues;
}

/** Flags answers that look like invented platform dumps vs live reads. */
export function honestyIssues(answer: string, intent?: string | null): string[] {
  const issues: string[] = [];
  if (/Zero Claude cost/i.test(answer) && intent !== "platform_read" && intent !== "market_context") {
    issues.push("marketing-tag");
  }
  if (/\b(unavailable|no data|not available|couldn't compose|rephrase)\b/i.test(answer)) {
    return issues;
  }
  if (answer.length > 80 && !/\d/.test(answer) && !/\b(none|flat|inactive|scanning)\b/i.test(answer)) {
    issues.push("no-grounded-numbers");
  }
  return issues;
}
