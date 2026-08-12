/**
 * ANSWER LAYOUT — let the question decide the shape of the answer.
 *
 * "Is 7800 holding?", "META or NVDA?", "what are the best trades right now?" and "what happened to
 * SPX today?" are four different questions that were all rendered as the same stack of prose
 * sections. The information was there; the SHAPE never matched what was being asked, so the member
 * had to re-derive the comparison, the ranking or the timeline themselves from paragraphs.
 *
 * THE SAFETY RULE, and it is the whole design: LAYOUT REORDERS AND EMPHASISES, IT NEVER DROPS.
 * A classifier over question text will misfire — a question can be two things at once, and
 * phrasing is unbounded. If a wrong layout could hide a section, every misfire would be a silent
 * data loss, and a member would have no way to know an answer was incomplete. So a layout only
 * chooses what LEADS. Every block the envelope carries is rendered under every layout.
 *
 * That constraint is what makes a keyword classifier acceptable here. The cost of a miss is a
 * slightly-wrong emphasis, which the member can see and ignore, rather than a missing fact, which
 * they cannot.
 *
 * ORDER MATTERS in the checks below: a question can match several patterns, and the first match
 * wins. The sequence runs most-specific to least, so "compare META and NVDA levels" resolves as a
 * comparison rather than as a level question.
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */

export type AnswerLayout =
  /** "Is 7800 holding?" — one level, its strength, and what breaks it. */
  | "level"
  /** "META or NVDA?" — two or more named instruments, side by side. */
  | "comparison"
  /** "Best trades right now?" — an ordered list with grades. */
  | "ranking"
  /** "What happened to SPX today?" — ordered by time. */
  | "recap"
  /** "Where is the flow?" — tape-led. */
  | "flow"
  /** "Why is SPX moving?" — regime, drivers, bull vs bear, level map. */
  | "market"
  /** "What is a good options play on NVDA today?" — decision-first, not an essay. */
  | "trade"
  /** Anything else — the general desk read. */
  | "default";

/**
 * Comparison intent, in TWO regexes because they need different case rules.
 *
 * The WORDS are case-insensitive ("Compare", "compare", "VS"). The TICKER pair must stay
 * case-SENSITIVE: `[A-Z]{2,5} or [A-Z]{2,5}` is what distinguishes "META or NVDA" from "cat or
 * dog", and lowercasing it would classify half of all English questions as comparisons.
 */
const COMPARISON_WORDS_RE =
  /\b(vs\.?|versus|compare[ds]?|comparison|which (?:is |one )?(?:better|stronger)|better than)\b/i;
const COMPARISON_TICKERS_RE = /\b[A-Z]{2,5}\s+or\s+[A-Z]{2,5}\b/;

const TRADE_RE =
  /\b(?:(?:good|best|what|any|which)\s+(?:options?\s+)?(?:play|trade|setup|entry)|(?:should i|can i)\s+(?:take|buy|play|trade)|options?\s+play\s+(?:on|for|to)|what(?:'s| is)\s+(?:the\s+)?(?:play|trade|setup))\b/i;

/** Superlatives and list requests — the shape is an ordered set, not a paragraph. */
const RANKING_RE =
  /\b(best|top|worst|strongest|weakest|rank(?:ed|ing)?|highest|lowest|most|which .* should i)\b/i;

/** Past-tense / session-review language. */
const RECAP_RE =
  /\b(what happened|recap|review|so far today|today'?s (?:session|action|move)|this morning|yesterday|since (?:the )?open|how did .* (?:do|perform))\b/i;

/**
 * A specific price level in question. Requires a NUMBER — "is the wall holding" without one is a
 * structure question, not a level question, and gets the market layout.
 */
const LEVEL_RE =
  /\b(?:hold(?:ing|s)?|break(?:ing|s)?|breach|reclaim|defend|test(?:ing)?)\b[^.?!]{0,40}\b\d{2,6}(?:\.\d+)?\b|\b\d{2,6}(?:\.\d+)?\b[^.?!]{0,40}\b(?:hold(?:ing|s)?|break(?:ing|s)?|wall|level|support|resistance)\b/i;

const FLOW_RE = /\b(flow|sweeps?|prints?|premium|whales?|dark ?pool|unusual|tape)\b/i;

/** Causal / directional market questions. */
const MARKET_RE =
  /\b(why|what'?s (?:going on|happening|driving)|drop(?:ping)?|fall(?:ing)?|rall(?:y|ying)|sell(?:ing)? off|moving|regime|bias|direction|what matters)\b/i;

/**
 * Classify a question into a layout.
 *
 * Returns `default` for anything unrecognised — the general desk read is always a correct way to
 * render an answer, just not always the most pointed one. Defaulting is never a failure.
 */
export function classifyLayout(question: string | null | undefined): AnswerLayout {
  const q = String(question ?? "").trim();
  if (!q) return "default";

  // Most specific first — see the ORDER MATTERS note above.
  if (COMPARISON_WORDS_RE.test(q) || COMPARISON_TICKERS_RE.test(q)) return "comparison";
  if (TRADE_RE.test(q)) return "trade";
  if (RANKING_RE.test(q)) return "ranking";
  if (RECAP_RE.test(q)) return "recap";
  if (LEVEL_RE.test(q)) return "level";
  if (FLOW_RE.test(q)) return "flow";
  if (MARKET_RE.test(q)) return "market";
  return "default";
}

/** Block identifiers the desk-read card can render, in the order the default layout uses. */
export type AnswerBlock = "systemReads" | "signals" | "gexShifts" | "ladder" | "sections" | "invalidation";

// SYSTEM READS leads by default: "do the systems agree?" is the question a member cannot
// answer by opening a tab, and it frames everything below it.
const DEFAULT_ORDER: AnswerBlock[] = ["systemReads", "signals", "gexShifts", "ladder", "sections", "invalidation"];

/**
 * Which block leads, per layout.
 *
 * EVERY LAYOUT LISTS EVERY BLOCK. That is enforced by `blockOrder` below rather than left to
 * whoever edits this table: a layout that omitted one would silently drop content, which is the one
 * failure this module must not have. The table only permutes.
 */
const LAYOUT_ORDER: Record<AnswerLayout, AnswerBlock[]> = {
  // The level itself first — where price sits relative to it is the answer.
  level: ["ladder", "gexShifts", "signals", "systemReads", "sections", "invalidation"],
  // What breaks the thesis is the point of a comparison or a ranking, so reasoning leads.
  comparison: ["sections", "signals", "ladder", "invalidation"],
  ranking: ["sections", "signals", "ladder", "invalidation"],
  recap: ["sections", "ladder", "signals", "invalidation"],
  // Flow questions want the directional tally before the structure.
  flow: ["signals", "sections", "ladder", "invalidation"],
  trade: ["signals", "ladder", "invalidation"],
  // "Why is it moving" — the read, then what confirms or breaks it.
  market: ["signals", "ladder", "sections", "invalidation"],
  default: DEFAULT_ORDER,
};

/**
 * The block order for a layout, guaranteed to contain every block exactly once.
 *
 * Any block missing from the table is appended in default order rather than dropped, so a future
 * edit that forgets one degrades to "rendered last" instead of "rendered never".
 */
export function blockOrder(layout: AnswerLayout): AnswerBlock[] {
  const configured = LAYOUT_ORDER[layout] ?? DEFAULT_ORDER;
  const seen = new Set(configured);
  const missing = DEFAULT_ORDER.filter((b) => !seen.has(b));

  // Missing blocks are inserted BEFORE `invalidation`, not appended after it. Appending was the
  // first version and it silently broke the other invariant: invalidation is the STOP CONDITION and
  // must be the last thing a member reads, so a block added to DEFAULT_ORDER later would have
  // pushed itself past it in every layout that had not been updated. Caught by the test that
  // asserts invalidation is last under every layout.
  const merged = [...configured.filter((b) => b !== "invalidation"), ...missing.filter((b) => b !== "invalidation")];
  return [...merged, "invalidation"];
}

/** Human label for the layout, shown only in dev tooling — never in the member-facing card. */
export const LAYOUT_LABEL: Record<AnswerLayout, string> = {
  level: "Level analysis",
  comparison: "Comparison",
  ranking: "Ranking",
  recap: "Session recap",
  flow: "Flow analysis",
  trade: "Trade decision",
  market: "Market read",
  default: "Desk read",
};
