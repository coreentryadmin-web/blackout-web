import type { BieBias } from "@/lib/bie/answer-envelope";

/**
 * MARKET STATE — the badge, derived so it cannot contradict the answer under it.
 *
 * THE BUG THIS REPLACES. The envelope's bias came from `firstMatch(verdict, BIAS_WORDS)`, which
 * iterates the WORD TABLE and returns on the first key found anywhere in the text. `bullish` was
 * the first key. So a verdict reading "Bearish price structure overwhelms bullish flow — the
 * signals genuinely conflict, no clean entry" was badged **BULLISH**: table key order decided the
 * headline, not the sentence. A member who scans the badge and skips the prose — which is what a
 * badge is FOR — read the exact opposite of the analysis.
 *
 * DIRECTION AND ACTION ARE DIFFERENT VARIABLES, and collapsing them is the second half of the same
 * mistake. "Bullish" and "take a long" are not the same claim: a bullish read with two systems
 * disagreeing and no level reclaimed is a REASON TO WAIT, and a badge that cannot say that has to
 * either overstate the direction or understate it. They are modelled separately here.
 *
 * CONFLICT BEATS EITHER SIDE. When both directions are asserted in one verdict, the answer is
 * MIXED — not the stronger one, not the first one, not the last one. That is a rule, not a
 * heuristic: an answer that names both sides has told us it is conflicted, and any collapse to a
 * single direction destroys information the writer deliberately included.
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */

/** The direction ladder, ordered bearish → bullish. `no-read` is an absence, not a middle. */
export type MarketState =
  | "strong-bearish"
  | "bearish"
  | "bearish-unconfirmed"
  | "mixed"
  | "bullish-unconfirmed"
  | "bullish"
  | "strong-bullish"
  | "neutral"
  | "no-read";

/** What to DO, which is not what the market IS. */
export type ActionState = "actionable" | "wait" | "scanning" | "unknown";

export const MARKET_STATE_LABEL: Record<MarketState, string> = {
  "strong-bearish": "STRONG BEARISH",
  bearish: "BEARISH",
  "bearish-unconfirmed": "BEARISH BIAS · UNCONFIRMED",
  mixed: "MIXED",
  "bullish-unconfirmed": "BULLISH BIAS · UNCONFIRMED",
  bullish: "BULLISH",
  "strong-bullish": "STRONG BULLISH",
  neutral: "NEUTRAL",
  "no-read": "NO READ",
};

export const ACTION_STATE_LABEL: Record<ActionState, string> = {
  actionable: "ACTIONABLE",
  wait: "WAIT",
  scanning: "SCANNING",
  unknown: "",
};

/** Whole words only, so "bullishness" counts and "bull market ETF" does not become a signal. */
const BULL_RE = /\b(bullish|upside|long bias)\b/gi;
const BEAR_RE = /\b(bearish|downside|short bias)\b/gi;
const NEUTRAL_RE = /\b(neutral|balanced|rangebound|range-bound)\b/gi;
/**
 * Explicit conflict language. This OVERRIDES a one-sided word count: an answer that says
 * "conflicted" has stated its own state more directly than any tally can infer it.
 */
const CONFLICT_RE = /\b(mixed|conflict|conflicted|conflicting|disagree|disagrees|disagreement|two-sided|at odds)\b/i;
/** The answer has a lean but says the confirmation has not arrived. */
const UNCONFIRMED_RE = /\b(unconfirmed|not (?:yet )?confirmed|awaiting confirmation|needs confirmation|no clean entry)\b/i;
/** Language that only appears when the writer means it. */
const STRONG_RE = /\b(strong|strongly|decisive|decisively|overwhelming|overwhelmingly|clear|clearly)\b/i;

function countOf(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

/**
 * Derive the direction state from the verdict prose.
 *
 * The order of these checks IS the logic and each precedence is deliberate:
 *  1. Explicit conflict language wins outright — the writer said it.
 *  2. Both directions present ⇒ mixed, regardless of which appears more. Counting would let
 *     "bearish, bearish, bearish, but genuinely bullish flow" resolve bearish and drop the "but",
 *     which is precisely the clause a member needs.
 *  3. One direction, hedged by unconfirmed language ⇒ the `-unconfirmed` rung.
 *  4. One direction, emphatic ⇒ the `strong-` rung.
 *  5. Neutral language with no direction ⇒ neutral (a FINDING: the tape is balanced).
 *  6. Nothing at all ⇒ `no-read` — an absence, never neutral. The old code defaulted to neutral
 *     here, which reported "we looked and it's balanced" for answers that stated no direction.
 */
export function deriveMarketState(verdict: string): MarketState {
  const text = String(verdict ?? "");
  if (!text.trim()) return "no-read";

  const bull = countOf(text, BULL_RE);
  const bear = countOf(text, BEAR_RE);

  if (CONFLICT_RE.test(text)) return "mixed";
  if (bull > 0 && bear > 0) return "mixed";

  if (bull > 0) {
    if (UNCONFIRMED_RE.test(text)) return "bullish-unconfirmed";
    return STRONG_RE.test(text) ? "strong-bullish" : "bullish";
  }
  if (bear > 0) {
    if (UNCONFIRMED_RE.test(text)) return "bearish-unconfirmed";
    return STRONG_RE.test(text) ? "strong-bearish" : "bearish";
  }

  if (countOf(text, NEUTRAL_RE) > 0) return "neutral";
  return "no-read";
}

/**
 * Derive the action state.
 *
 * Read from the answer's own language rather than inferred from direction, because the whole point
 * of separating them is that a strong direction can still be a wait. Nothing is invented: with no
 * action language the state is `unknown` and the renderer shows no action line at all, rather than
 * defaulting to "WAIT" and putting a recommendation in Largo's mouth.
 */
export function deriveActionState(text: string): ActionState {
  const t = String(text ?? "");
  if (/\bscanning\b/i.test(t)) return "scanning";
  if (/\b(wait|stand aside|no trade|no clean entry|sit out|patience)\b/i.test(t)) return "wait";
  if (/\b(actionable|entry is|take the|clean entry|setup is live)\b/i.test(t)) return "actionable";
  return "unknown";
}

/**
 * Collapse to the legacy 4-value bias for consumers that still take one.
 *
 * The `-unconfirmed` rungs map to their DIRECTION, not to mixed: a hedged bullish read is still
 * bullish, just not confirmed, and flattening it to mixed would report a conflict that does not
 * exist. `no-read` maps to neutral only here, at the boundary, where the older type has no way to
 * express an absence — never upstream, where the distinction still matters.
 */
export function marketStateToBias(state: MarketState): BieBias {
  switch (state) {
    case "strong-bullish":
    case "bullish":
    case "bullish-unconfirmed":
      return "bullish";
    case "strong-bearish":
    case "bearish":
    case "bearish-unconfirmed":
      return "bearish";
    case "mixed":
      return "mixed";
    default:
      return "neutral";
  }
}

/** True when the badge should read as a conflict rather than a direction. */
export function isConflicted(state: MarketState): boolean {
  return state === "mixed";
}
