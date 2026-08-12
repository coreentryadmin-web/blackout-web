/**
 * TRADE / PLAY RECOMMENDATION questions — detection and pre-synthesis format hints.
 *
 * PURE AND TOTAL: no IO, no throw.
 */

const TRADE_RE =
  /\b(?:(?:good|best|what|any|which)\s+(?:options?\s+)?(?:play|trade|setup|entry)|(?:should i|can i)\s+(?:take|buy|play|trade)|options?\s+play\s+(?:on|for|to)|(?:call|put)\s+(?:to\s+)?(?:take|buy|play)|what(?:'s| is)\s+(?:the\s+)?(?:play|trade|setup))\b/i;

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
    `**When 0DTE Command has NO open play for ${tk}:** you may discuss what *could* play out from ` +
    `flow/GEX/structure, but label it clearly as **not on the board** / conditional — never as a ` +
    `committed scanner play. The UI will add an integrity badge; your job is the honest read.\n`
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
