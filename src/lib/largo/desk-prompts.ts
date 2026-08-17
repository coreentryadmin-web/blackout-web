/**
 * First-class one-tap prompts for /terminal — the questions that previously 502'd or
 * needed cross-desk synthesis. Each carries a member-facing label and the exact question
 * Largo receives (may differ: compare intent triggers structured prefetch).
 */

export type LargoDeskPrompt = {
  id: string;
  label: string;
  hint: string;
  question: string;
  /** When true, server prefetches HELIX+Thermal compare card before the model runs. */
  compareCard?: boolean;
  /** When true, server prefetches multi-ticker flow+gamma peer compare. */
  peerCompare?: boolean;
  playSimilarity?: boolean;
  preEarningsPack?: boolean;
  /** When true, server prefetches social content pack (winners, SPX, record). */
  socialPack?: boolean;
};

/** Compact chips in the composer and native terminal. */
export const LARGO_DESK_PROMPTS: LargoDeskPrompt[] = [
  {
    id: "spx-setup",
    label: "SPX setup",
    hint: "Structure, flip, walls, and what the desk is leaning on",
    question: "What's the SPX setup right now — flip, walls, and dealer positioning?",
  },
  {
    id: "flow-gex-conflict",
    label: "Flow vs GEX",
    hint: "HELIX net flow vs Thermal gamma regime side by side",
    question: "Compare HELIX flow vs Thermal GEX on SPX — where do they disagree?",
    compareCard: true,
  },
  {
    id: "zerodte-pnl",
    label: "0DTE board P&L",
    hint: "Open Night Hawk / 0DTE plays and live marks",
    question: "What's the 0DTE board P&L — open plays, marks, and any stopped positions?",
  },
  {
    id: "peer-compare",
    label: "NVDA vs AMD vs SMH",
    hint: "Flow + gamma side-by-side for earnings and peer days",
    question: "Compare NVDA vs AMD vs SMH — flow and gamma side by side for earnings week.",
    peerCompare: true,
  },
  {
    id: "play-similarity",
    label: "Plays like NVDA",
    hint: "k-NN analogs from the 0DTE feature store with outcome distribution",
    question: "Find past plays like today's NVDA 0DTE — show the outcomes distribution.",
    playSimilarity: true,
  },
  {
    id: "pre-earnings",
    label: "Pre-earnings NVDA",
    hint: "Positioning, flow, history, and board exposure in one pack",
    question: "Pre-earnings desk pack for NVDA — positioning, flow into the print, historical moves, and any 0DTE exposure.",
    preEarningsPack: true,
  },
  {
    id: "x-winners",
    label: "X · today's winners",
    hint: "Banger post from live 0DTE board P&L + screenshot list",
    question:
      "Draft an X post about today's winning 0DTE plays — hook, tweet copy, alt hooks, and exactly which desk screenshots to attach. Use only live board numbers.",
    socialPack: true,
  },
  {
    id: "x-platform",
    label: "X · platform showcase",
    hint: "Full-desk story for @BlackOutTrade",
    question:
      "Draft an X post showcasing the BlackOut desk — what makes it different, one provocative hook, tweet copy, and which tool screenshots to attach.",
    socialPack: true,
  },
  {
    id: "x-spx-desk",
    label: "X · SPX live read",
    hint: "Live SPX levels + flow vs gamma post",
    question:
      "Draft an X post for the current SPX setup — flip, walls, flow vs gamma, tweet copy, and screenshot list.",
    socialPack: true,
  },
  {
    id: "x-win-recap",
    label: "X · win recap",
    hint: "Single play evolution — Night Hawk → Helix → Thermal",
    question:
      "Draft an X win-recap post for the best green play on today's 0DTE board — timeline story, copy, and panels to screenshot.",
    socialPack: true,
  },
  {
    id: "x-meridian-earnings",
    label: "X · earnings catalyst",
    hint: "Meridian intel + Helix + Thermal screenshot workflow",
    question:
      "Draft an X post for the next high-impact earnings name on Meridian — copy, CTA, and step-by-step screenshots from Meridian, Helix, and Thermal.",
    socialPack: true,
  },
  {
    id: "x-full-workflow",
    label: "X · full screenshot guide",
    hint: "Baby-sit every desk panel for a platform post",
    question:
      "I'm posting on X today — give me tweet copy AND a complete screenshot workflow: Helix filters, Thermal (Mag7 if relevant), Vector, Night Hawk plays, SPX Slayer if needed, with exact clicks and what to capture from each tool.",
    socialPack: true,
  },
];

/** Empty-state showcase — same three intents, phrased as questions. */
export const LARGO_DESK_EXAMPLE_PROMPTS: LargoDeskPrompt[] = LARGO_DESK_PROMPTS;

/** Legacy export shape for chips that only need the question string. */
export const LARGO_SUGGESTION_QUESTIONS = LARGO_DESK_PROMPTS.map((p) => p.question);

export function deskPromptById(id: string): LargoDeskPrompt | undefined {
  return LARGO_DESK_PROMPTS.find((p) => p.id === id);
}

export function questionWantsCompareCard(question: string): boolean {
  const q = question.toLowerCase();
  if (questionWantsPeerCompare(question)) return false;
  return (
    /\b(helix|flow)\b.*\b(thermal|gex|gamma)\b/i.test(q) ||
    /\b(thermal|gex|gamma)\b.*\b(helix|flow)\b/i.test(q) ||
    /\bflow vs gex\b/i.test(q) ||
    /\bwhere do (?:they|the systems) disagree\b/i.test(q)
  );
}

const PEER_COMPARE_STOPWORDS = new Set([
  "I",
  "A",
  "AN",
  "THE",
  "VS",
  "AND",
  "OR",
  "ET",
  "AI",
  "GEX",
  "RTH",
  "DTE",
  "FOR",
  "ON",
  "IN",
  "TO",
  "IT",
  "IS",
  "AT",
  "BY",
  "OF",
  "MY",
  "ME",
  "WE",
  "US",
  "DO",
  "SO",
  "IF",
  "AS",
  "BE",
  "HE",
  "SHE",
  "ALL",
  "DAY",
  "WEEK",
  "NOW",
  "BUY",
  "PUT",
  "CALL",
  "FLOW",
  "GAMMA",
  "HELIX",
  "THERMAL",
  "COMPARE",
  "SIDE",
]);

/** Extract 2–3 tickers from a peer-compare question; defaults to NVDA/AMD/SMH when unspecified. */
export function extractPeerCompareTickers(question: string): string[] {
  const q = String(question ?? "").trim();
  if (!q) return [];

  const vsChain =
    q.match(
      /\b([A-Z]{1,5})\s+(?:vs\.?|versus)\s+([A-Z]{1,5})(?:\s+(?:vs\.?|versus|,)\s+([A-Z]{1,5}))?/i
    ) ?? q.match(/\b([A-Z]{1,5})\s*,\s*([A-Z]{1,5})\s*(?:,|and)\s*([A-Z]{1,5})\b/i);

  if (vsChain) {
    const tickers = [vsChain[1], vsChain[2], vsChain[3]]
      .filter((t): t is string => Boolean(t))
      .map((t) => t.toUpperCase())
      .filter((t) => !PEER_COMPARE_STOPWORDS.has(t) && t.length >= 2);
    const deduped = [...new Set(tickers)];
    if (deduped.length >= 2) return deduped.slice(0, 3);
  }

  const tokens =
    q.match(/\$?[A-Z][A-Z0-9]{0,4}\b/g)?.map((t) => t.replace(/^\$/, "").toUpperCase()) ?? [];
  const named = [...new Set(tokens.filter((t) => !PEER_COMPARE_STOPWORDS.has(t) && t.length >= 2))];
  if (named.length >= 2) return named.slice(0, 3);

  if (
    /\bcompare\s+(three|3)\s+tickers?\b/i.test(q) ||
    /\b(earnings|peer|semiconductor|chip)\b/i.test(q)
  ) {
    return ["NVDA", "AMD", "SMH"];
  }

  return [];
}

/** True when the member wants 2–3 tickers compared on flow + gamma (not HELIX-vs-Thermal on one name). */
export function questionWantsPeerCompare(question: string): boolean {
  const q = String(question ?? "").trim();
  if (!q) return false;

  if (/\bcompare\s+(three|3)\s+tickers?\b/i.test(q)) return true;
  if (/\bnvda\s+vs\s+amd(\s+vs\s+smh)?\b/i.test(q)) return true;

  const tickers = extractPeerCompareTickers(q);
  if (tickers.length < 2) return false;

  return (
    /\b(vs|versus|compare|side.?by.?side|peer|earnings|relative)\b/i.test(q) ||
    (tickers.length >= 3 && /\bflow\b.*\bgamma\b|\bgamma\b.*\bflow\b/i.test(q))
  );
}

const TICKER_TOKEN = /\$?([A-Z][A-Z0-9]{0,4})\b/g;

/** Extract primary ticker for play-similarity / pre-earnings asks. */
export function extractStructuredTicker(question: string, fallback = "NVDA"): string {
  const q = String(question ?? "").trim();
  const stop = new Set([...PEER_COMPARE_STOPWORDS, "PAST", "PLAYS", "LIKE", "TODAY", "FIND", "PACK", "DESK"]);
  const tokens = [...q.matchAll(TICKER_TOKEN)].map((m) => m[1]!.toUpperCase());
  for (const t of tokens) {
    if (!stop.has(t) && t.length >= 2 && t.length <= 5) return t;
  }
  return fallback;
}

/** True when the member wants k-NN past-play analogs with outcome distribution. */
export function questionWantsPlaySimilarity(question: string): boolean {
  const q = String(question ?? "").trim();
  if (!q) return false;
  return (
    /\bpast plays like\b/i.test(q) ||
    /\bplays like today'?s?\b/i.test(q) ||
    /\bsimilar (?:0dte|0 dte|plays?)\b/i.test(q) ||
    /\boutcomes? distribution\b/i.test(q) ||
    /\bfind.*like today'?s?\b/i.test(q)
  );
}

/** True when the member wants a pre-earnings bundled desk read. */
export function questionWantsPreEarningsPack(question: string): boolean {
  const q = String(question ?? "").trim();
  if (!q) return false;
  return (
    /\bpre-?earnings\b/i.test(q) ||
    /\binto earnings\b/i.test(q) ||
    /\bbefore earnings\b/i.test(q) ||
    /\bearnings desk pack\b/i.test(q) ||
    /\bearnings pack\b/i.test(q)
  );
}

/** True when the member wants X/Twitter/social post copy (prefetch winners + record). */
export function questionWantsSocialContentPack(question: string): boolean {
  const q = String(question ?? "").trim();
  if (!q) return false;
  return (
    /\b(x post|twitter post|tweet|social post|content for x|banger post|marketing post|post for x|draft.*post|create.*post|what should we post|social media|ads expert)\b/i.test(q) ||
    /\b(win recap|showcase post|platform post|winning plays post|attach.*screenshot|screenshot.*attach|screenshot workflow)\b/i.test(q)
  );
}

export function questionWantsMeridianPrefetch(question: string): boolean {
  const q = String(question ?? "").trim();
  if (!q) return false;
  return (
    /\b(meridian|catalyst calendar|opex preview|macro desk|earnings post|earnings intel|fda calendar)\b/i.test(q) ||
    (questionWantsSocialContentPack(q) &&
      /\b(earnings|macro|opex|catalyst|cpi|fomc|nfp)\b/i.test(q))
  );
}

/** Optional YYYY-MM-DD after "on/for <date>" in pre-earnings questions. */
export function extractPreEarningsDate(question: string): string | null {
  const m = String(question ?? "").match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return m ? m[1]! : null;
}
