/**
 * TRADE / PLAY RECOMMENDATION questions — detection and pre-synthesis format hints.
 *
 * "What is a good options play on NVDA today?" is a DECISION question, not a desk essay.
 * The model still reasons dynamically (tool loop, live feed); this module tells it WHAT SHAPE
 * the answer must take and lets the UI render the same structure deterministically.
 *
 * PURE AND TOTAL: no IO, no throw.
 */

const TRADE_RE =
  /\b(?:(?:good|best|what|any|which)\s+(?:options?\s+)?(?:play|trade|setup|entry)|(?:should i|can i)\s+(?:take|buy|play|trade)|options?\s+play\s+(?:on|for|to)|(?:call|put)\s+(?:to\s+)?(?:take|buy|play)|what(?:'s| is)\s+(?:the\s+)?(?:play|trade|setup))\b/i;

/** True when the member is asking for a trade recommendation, not a general read. */
export function isTradeRecommendationQuestion(question: string | null | undefined): boolean {
  return TRADE_RE.test(String(question ?? "").trim());
}

/**
 * Pre-synthesis block: decision-first answer shape + entity ontology reminders.
 * Appended to the turn system context (like the temporal block).
 */
export function formatTradeAnswerBlock(ticker: string | null): string {
  const tk = ticker ?? "the ticker";
  return (
    `\n\n## Trade recommendation — decision-first format (mandatory for this question)\n` +
    `The member wants a **decision**, not an essay. Lead with whether there is a clean entry NOW.\n\n` +
    `**Verdict** — exactly one line in this shape:\n` +
    `\`🟡 ${tk} — <ACTION HEADLINE>\`\n` +
    `Examples: \`NO CLEAN FRESH ENTRY YET\`, \`WAIT FOR CONFIRMATION\`, \`STRUCTURE NOT RECLAIMED\`. ` +
    `Never open with flow narrative.\n\n` +
    `Immediately after Verdict, emit a **comparison** blackout block (signal alignment table):\n` +
    `\`\`\`blackout\n` +
    `{ "type": "comparison", "title": "Signal", "rows": [\n` +
    `  { "label": "Helix Flow", "reading": "<net from tape>", "tone": "bullish|bearish|neutral|warning" },\n` +
    `  { "label": "Dealer regime", "reading": "<gamma posture>", "tone": "warning" },\n` +
    `  { "label": "VWAP", "reading": "<price>, spot above|below", "tone": "..." },\n` +
    `  { "label": "Gamma flip", "reading": "<price>, spot above|below", "tone": "..." },\n` +
    `  { "label": "Night Hawk", "reading": "<edition vs 0DTE board — name the product>", "tone": "..." },\n` +
    `  { "label": "Vector", "reading": "<Vector play bias>", "tone": "..." }\n` +
    `] }\n\`\`\`\n\n` +
    `Then **one short callout** (blackout \`callout\` or prose): Best approach — wait vs enter, ` +
    `what level must reclaim first. If Night Hawk evening edition lists a contract, call it an ` +
    `**existing thesis**, not a fresh recommendation — state original entry and that current ` +
    `contract price/trigger must be revalidated before chasing.\n\n` +
    `**Scale down:** Facts ≤ 8 bullets. Interpretation ≤ 3 bullets. Omit Confidence unless genuinely ` +
    `needed. Omit Conflicts if none. Bottom line = one line: \`Overall: Mixed → WAIT FOR CONFIRMATION\`.\n\n` +
    `**Entity ontology (non-negotiable):**\n` +
    `- FLOW_STRIKE ≠ PUT_WALL / CALL_WALL — UW flow at 212.5 is not the dealer put wall.\n` +
    `- OPTION_STRIKE ≠ GAMMA_FLIP — compare spot to flip, not option strike to flip.\n` +
    `- Classify horizons: Aug 24 on today's session is SWING, not 0DTE.\n` +
    `- Night Hawk **evening edition** ≠ 0DTE Command **open plays** — say which product.\n` +
    `- EMA stack = price vs EMA20 vs EMA50 (Vector definition) — do not claim "stack down" when spot > EMA20 > EMA50.\n` +
    `- If spot prices disagree >1% across sources, do NOT state precise entry/stop/target — say levels are withheld.\n`
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
