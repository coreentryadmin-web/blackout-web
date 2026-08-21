/**
 * TRADE / PLAY RECOMMENDATION questions — detection and pre-synthesis format hints.
 *
 * PURE AND TOTAL: no IO, no throw.
 */

// The qualifier and the noun are allowed up to two SHORT words between them.
//
// This used to require them adjacent — `(good|best|what|…)\s+(?:options?\s+)?(play|trade|…)` — so
// "what's the best SPX play today?" did not match, because "SPX" sits in the gap. That is the most
// natural way a member asks the question, and it meant `formatTradeAnswerBlock` was never injected
// for it: no contract contract, no probability rule, no empty-board handling. The desk answered a
// play question without knowing it was one.
//
// The gap is bounded at two tokens of ≤6 characters, non-greedy, rather than `.*`, so ordinary
// prose cannot bridge it: "what happened to my trade" still does not match ("happened" is 8), and
// an unbounded gap would make almost any sentence containing "trade" a recommendation request.
const TRADE_RE =
  /\b(?:(?:good|best|what|any|which)\s+(?:[a-z0-9]{1,6}\s+){0,2}?(?:options?\s+)?(?:play|trade|setup|entry)|(?:should i|can i)\s+(?:take|buy|play|trade)|options?\s+play\s+(?:on|for|to)|(?:call|put)\s+(?:to\s+)?(?:take|buy|play)|what(?:'s| is)\s+(?:the\s+)?(?:play|trade|setup))\b/i;

const ZERODTE_TRADE_RE =
  /\b(?:0\s*dte|0dte|same.?day|today'?s?\s+(?:expir|0dte)|intraday\s+(?:play|option))\b/i;

/** True when the member is asking for a trade recommendation, not a general read. */
export function isTradeRecommendationQuestion(question: string | null | undefined): boolean {
  return TRADE_RE.test(String(question ?? "").trim());
}

/** Trade recommendation OR explicit 0DTE play ask. */
export function isPlayQuestion(question: string | null | undefined): boolean {
  return isTradeRecommendationQuestion(question) || isZeroDtePlayQuestion(question);
}

/** True when the member wants a same-session / 0DTE play idea (board or synthesis). */
export function isZeroDtePlayQuestion(question: string | null | undefined): boolean {
  const q = String(question ?? "").trim();
  if (!q) return false;
  return (
    ZERODTE_TRADE_RE.test(q) &&
    (isTradeRecommendationQuestion(q) || /\b(?:play|trade|setup|call|put|idea)\b/i.test(q))
  );
}

/**
 * Pre-synthesis hints for trade/play questions — guidance, not a fixed script.
 */
export function formatTradeAnswerBlock(ticker: string | null): string {
  const tk = ticker ?? "the ticker";
  return (
    `\n\n## Trade / play question — answer THIS question from live data\n` +
    `The member asked for a **trade decision on ${tk}**. Read their exact wording and answer it — ` +
    `do not paste a generic template.\n\n` +
    `**Verdict** — your direct answer in plain language (one short paragraph max). ` +
    `State whether there is a clean entry NOW, what product (0DTE board vs evening edition vs synthesis) ` +
    `you are referencing, and what would change your read.\n\n` +
    `Optional but helpful: a \`\`\`blackout comparison\`\`\` block if signals are easier as a table. ` +
    `If you skip it, the desk may show a fallback signal grid from tools.\n\n` +
    `Keep **Facts** grounded (numbers from this turn's tools). **Interpretation** = your reasoning for ` +
    `THIS ticker and THIS question only. Skip sections with nothing to say.\n\n` +
    `**Entity ontology (non-negotiable):**\n` +
    `- FLOW_STRIKE ≠ PUT_WALL / CALL_WALL\n` +
    `- OPTION_STRIKE ≠ GAMMA_FLIP\n` +
    `- Classify horizons correctly (Aug 24 on today's session is SWING, not 0DTE)\n` +
    `- Evening edition ≠ 0DTE Command open plays — name which product\n` +
    `- If spot sources disagree >1%, withhold precise entry/stop/target\n\n` +
    `**When 0DTE Command has NO open play for ${tk} — you STILL answer the question.**\n` +
    `"The board has no committed play" is an inventory status, not an answer. The member asked what ` +
    `to trade. An empty board changes the CONFIDENCE and the LABEL of your answer; it does not ` +
    `entitle you to withhold one. Never end on "wait for the open" alone when you hold spot, the ` +
    `walls, the flip and the flow — those are the inputs to a read, and you have them.\n` +
    `So name the actual contract:\n` +
    `- **Strike, right and expiry** — "SPX 7800C 08/21", not "a call above the wall". Pick the ` +
    `expiry off the trading-session list in this turn's calendar block; never name a date that is ` +
    `not a session.\n` +
    `- **Why that strike** — tie it to a real level (call wall, put wall, flip, max pain) with the ` +
    `distance from spot.\n` +
    `- **A probability, honestly sourced.** Call \`get_options_chain\`/\`get_greeks\` and use the ` +
    `contract's own **delta** as the probability it finishes in the money — that is what delta ` +
    `approximates, and it is a real number off the live chain. Say which it is: "≈32% to finish ITM ` +
    `(0.32 delta)". Two rules you must not break: P(ITM) is NOT probability of profit — a long ` +
    `option also has to clear the premium, so give the breakeven alongside it; and if you could not ` +
    `read a delta this turn, say the probability is unavailable. **Never invent a percentage.** A ` +
    `fabricated 68% is a worse failure than no number, because the member cannot check it.\n` +
    `- **Invalidation** — the level that kills the thesis.\n` +
    `Label it as **your read, not on the board** / conditional — never as a committed scanner play. ` +
    `The UI adds an integrity badge. Honest and specific, not vague and safe.\n`
  );
}

export function formatEvidenceOntologyBlock(): string {
  return (
    `\n\n## Evidence ontology (apply on every synthesis turn)\n` +
    `Before stating a level or recommendation, classify it:\n` +
    `- **FLOW_STRIKE** — UW/Polygon flow at a strike (not a dealer wall)\n` +
    `- **CALL_WALL / PUT_WALL / GAMMA_FLIP / GAMMA_MAGNET / VWAP** — structure from Vector/Thermal\n` +
    `- **OPTION_STRIKE** — a contract in a playbook (Night Hawk edition, 0DTE board)\n` +
    `- **SPOT** — underlying price (one authoritative reading; if sources disagree, say so)\n` +
    `- **Horizon** — 0DTE / 1DTE / SWING / LEAP per contract vs session date\n` +
    `Long-dated whale flow may support a thesis but does NOT validate a 1DTE entry without reclaim confirmation.\n`
  );
}
