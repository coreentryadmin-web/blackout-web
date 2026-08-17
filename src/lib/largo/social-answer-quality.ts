/**
 * Score Largo answers for X / social marketing quality — used by live validation harness.
 */

import { sanitizeLargoMemberText } from "@/lib/largo/sanitize-member-text";
import {
  extractAltHooksFromAnswer,
  extractPostCopyFromAnswer,
} from "@/lib/largo/format-x-post";

export type SocialAnswerScore = {
  verdict: "GREEN" | "AMBER" | "RED";
  issues: string[];
  hasPostSection: boolean;
  hasCopy: boolean;
  copyLength: number | null;
  altHookCount: number;
  hasWorkflow: boolean;
  hasCta: boolean;
  vendorLeak: boolean;
  hashtagLeak: boolean;
};

const VENDOR_RE =
  /\b(unusual whales|polygon\.io|massive\.com|clerk|whop api|redis|postgres|aws|anthropic)\b/i;
const WORKFLOW_RE =
  /\*\*(?:screenshot workflow|attach)\*\*|screenshot workflow|#\s*helix-ticker-search|\/heatmap|\/flows|\/meridian/i;

export function scoreSocialAnswer(answer: string): SocialAnswerScore {
  const raw = String(answer ?? "");
  const sanitized = sanitizeLargoMemberText(raw);
  const issues: string[] = [];

  const hasPostSection = /(?:^|\n)(?:#+\s*Post\b|\*\*Post\*\*)/i.test(sanitized);
  const copy = extractPostCopyFromAnswer(sanitized);
  const altHooks = extractAltHooksFromAnswer(sanitized);
  const hasWorkflow = WORKFLOW_RE.test(sanitized);
  const hasCta = /\*\*CTA\*\*/i.test(sanitized);
  const vendorLeak = VENDOR_RE.test(raw);
  const hashtagLeak = /#\w{2,}/.test(
    sanitized.replace(/#helix-ticker-search|#ticker-listbox|#vector-tf-select/gi, ""),
  );

  if (!hasPostSection) issues.push("missing-post-section");
  if (!copy) issues.push("missing-copy");
  else if (copy.length > 240) issues.push("copy-too-long");
  else if (copy.length < 40) issues.push("copy-too-short");
  if (altHooks.length < 2) issues.push("alt-hooks-lt-2");
  if (!hasWorkflow) issues.push("missing-screenshot-workflow");
  if (!hasCta) issues.push("missing-cta");
  if (vendorLeak) issues.push("vendor-leak");
  if (hashtagLeak) issues.push("hashtag-leak");
  if (sanitized.length < 200) issues.push("answer-too-short");

  // Honest empty-board decline — still require Post section, but don't RED for missing copy if verdict explains why
  const honestEmptyBoard =
    /\b(empty|no committed|no fresh finds|can't draft|cannot draft|nothing to screenshot)\b/i.test(sanitized) &&
    /\b0dte|board|ledger\b/i.test(sanitized);
  if (honestEmptyBoard && !hasPostSection) {
    /* keep missing-post-section */
  } else if (honestEmptyBoard && hasPostSection && !copy) {
    const idx = issues.indexOf("missing-copy");
    if (idx >= 0) issues.splice(idx, 1);
  }

  const red = issues.some((i) =>
    ["missing-post-section", "vendor-leak", "answer-too-short"].includes(i) ||
    (i === "missing-copy" && !honestEmptyBoard),
  );
  const amber = issues.length > 0 && !red;

  return {
    verdict: red ? "RED" : amber ? "AMBER" : "GREEN",
    issues,
    hasPostSection,
    hasCopy: Boolean(copy),
    copyLength: copy?.length ?? null,
    altHookCount: altHooks.length,
    hasWorkflow,
    hasCta,
    vendorLeak,
    hashtagLeak,
  };
}
