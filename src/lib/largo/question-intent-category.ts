/**
 * LARGO QUESTION INTENT CATEGORY — maps questions to strategic intent, not just tool hints.
 *
 * The existing `analyzeLargoQuestion()` returns binary flags (needsFlow, needsSpxDesk, etc.)
 * that drive WHICH TOOLS to call. This layer adds CATEGORICAL INTENT that drives HOW TO
 * RESPOND — depth, structure, visual encoding, follow-up generation.
 *
 * Nine intent categories encode what the trader is actually TRYING TO DO:
 * - QUICK_FACT: "What's SPX?" → 1-line headline, no template bloat
 * - LEVEL_STRUCTURE: "Where are the walls?" → levels table + structure card
 * - FLOW: "What's printing?" → tape dynamics + top hits
 * - MARKET_READ: "What's the desk read?" → full multi-system consensus matrix
 * - COMPARISON: "SPX vs QQQ?" → side-by-side desk read comparison
 * - CHANGE_DETECTION: "What just changed?" → delta from cached snapshot
 * - TRADE_INTENT: "Should I buy calls?" → decision framework + invalidation
 * - VALIDATION: "Did X trigger?" → confirmation + grading
 * - WHY: "Why didn't it work?" → root cause analysis + precedent
 *
 * Each category gates response depth, system requirements, and component selection.
 */

import type { LargoQuestionIntent } from "@/lib/largo/question-intent";
import type { LargoProduct } from "@/lib/largo/registry/capability-registry";

export type QuestionIntentCategory =
  | "QUICK_FACT"
  | "LEVEL_STRUCTURE"
  | "FLOW"
  | "MARKET_READ"
  | "COMPARISON"
  | "CHANGE_DETECTION"
  | "TRADE_INTENT"
  | "VALIDATION"
  | "WHY";

export type ResponseDepth = "minimal" | "standard" | "deep" | "institutional";

export type IntentClassification = {
  /** The 9-category classification. */
  category: QuestionIntentCategory;
  /** How confident is this classification (0-1). */
  confidence: number;
  /** What aspect of the category, if any (e.g., flow → "unusual_volume"). */
  subCategory?: string;
  /** How much detail to include in response. */
  responseDepth: ResponseDepth;
  /** Which product systems MUST be consulted for this intent. */
  requiredSystems: LargoProduct[];
  /** Which systems add value but aren't critical. */
  optionalSystems: LargoProduct[];
  /** True if this is a play decision question that needs desk-read (PLAY/WAIT/NO_TRADE). */
  needsDeskRead: boolean;
  /** True if this question expects a historical root cause (precedents, grading). */
  needsHistoricalContext: boolean;
  /** Follow-up questions this answer should seed. */
  suggestedFollowUps?: string[];
};

// ── Pattern matching for each category ──

const QUICK_FACT_PATTERNS = [
  /^(?:what(?:'s| is)|how|where|when|which)\s+(?:the\s+)?(?:price|quote|spot|level|vix|vol|iv|bid|ask|spread)\b/i,
  /^\$?[A-Z]{1,5}\s*\?$/,
  /^(?:spx|spy|qqq|vix)\s*\?$/i,
  /^(?:up|down|flat|red|green)\?$/i,
];

const LEVEL_STRUCTURE_PATTERNS = [
  /\b(?:walls?|levels?|strike|gamma|flip|call wall|put wall|support|resistance|floor|ceiling|key level|pivot)\b/i,
  /\b(?:structure|chart|technical|obstacle|barrier|cap|base)\b/i,
  /\b(?:where.*wall|where.*level|what.*floor|what.*ceiling)\b/i,
];

const FLOW_PATTERNS = [
  /\b(?:flow|tape|print|sweep|whale|block|accumulation|buying|selling|volume)\b/i,
  /\b(?:what'?s printing|prints|showing|seeing)\b/i,
  /\b(?:flow brief|options flow|unusual|anomaly|hit)\b/i,
];

const MARKET_READ_PATTERNS = [
  /\b(?:desk read|what.*think|consensus|market.*view|picture|backdrop|regime|overall)\b/i,
  /\b(?:what'?s happening|what'?s going on|what'?s the.*situation)\b/i,
  /\b(?:is the market|the market.*right now|current.*environment)\b/i,
];

const COMPARISON_PATTERNS = [
  /\b(?:vs|versus|compare|comparison|side by side|which.*better|qqq.*spy|spy.*qqq)\b/i,
  /(?:spx|spy|qqq|iwm).*(?:spx|spy|qqq|iwm)/i,
];

const CHANGE_DETECTION_PATTERNS = [
  /\b(?:just|changed|shift|flip|moved|shift|what'?s new|what changed|delta)\b/i,
  /\b(?:since|since.*ago|in the last|over the last|over the past)\s+(?:minute|hour|session|open)\b/i,
];

const TRADE_INTENT_PATTERNS = [
  /\b(?:should i|buy|sell|call|put|long|short|position|trade|play|enter|exit|get in|get out)\b/i,
  /\b(?:good setup|make sense|worth|risk|conviction|confidence|go)\b/i,
];

const VALIDATION_PATTERNS = [
  /\b(?:did|did.*trigger|confirm|confirmed|hit|fired|filled|executed|closed|graded)\b/i,
  /\b(?:how did|what happened|outcome|result|grade|win|loss|lose)\b/i,
];

const WHY_PATTERNS = [
  /\b(?:why|why didn't|why didn't.*trigger|why didn't.*fire|why didn't.*work|what went wrong)\b/i,
  /\b(?:root cause|explanation|reason|because|caused by)\b/i,
];

function scorePatterns(text: string, patterns: RegExp[]): number {
  const matches = patterns.filter((p) => p.test(text)).length;
  return matches / Math.max(patterns.length, 1);
}

export function detectIntentCategory(
  question: string,
  binaryIntent: LargoQuestionIntent
): IntentClassification {
  const textLower = question.toLowerCase();

  // Score each category based on pattern matching
  const scores = {
    QUICK_FACT: scorePatterns(textLower, QUICK_FACT_PATTERNS),
    LEVEL_STRUCTURE: scorePatterns(textLower, LEVEL_STRUCTURE_PATTERNS),
    FLOW: scorePatterns(textLower, FLOW_PATTERNS),
    MARKET_READ: scorePatterns(textLower, MARKET_READ_PATTERNS),
    COMPARISON: scorePatterns(textLower, COMPARISON_PATTERNS),
    CHANGE_DETECTION: scorePatterns(textLower, CHANGE_DETECTION_PATTERNS),
    TRADE_INTENT: scorePatterns(textLower, TRADE_INTENT_PATTERNS),
    VALIDATION: scorePatterns(textLower, VALIDATION_PATTERNS),
    WHY: scorePatterns(textLower, WHY_PATTERNS),
  };

  // Pick highest-scoring category
  let topCategory: QuestionIntentCategory = "MARKET_READ"; // default
  let topScore = 0;
  for (const [category, score] of Object.entries(scores)) {
    if (score > topScore) {
      topScore = score;
      topCategory = category as QuestionIntentCategory;
    }
  }

  // Map category to response depth and system requirements
  const config = mapCategoryToConfig(topCategory, binaryIntent);

  return {
    category: topCategory,
    confidence: topScore,
    responseDepth: config.depth,
    requiredSystems: config.required,
    optionalSystems: config.optional,
    needsDeskRead: config.needsDeskRead,
    needsHistoricalContext: config.needsHistorical,
  };
}

type CategoryConfig = {
  depth: ResponseDepth;
  required: LargoProduct[];
  optional: LargoProduct[];
  needsDeskRead: boolean;
  needsHistorical: boolean;
};

function mapCategoryToConfig(category: QuestionIntentCategory, binaryIntent: LargoQuestionIntent): CategoryConfig {
  switch (category) {
    case "QUICK_FACT":
      return {
        depth: "minimal",
        required: ["MARKET"], // just quote
        optional: [],
        needsDeskRead: false,
        needsHistorical: false,
      };

    case "LEVEL_STRUCTURE":
      return {
        depth: "standard",
        required: ["THERMAL", "VECTOR"], // GEX walls + technicals
        optional: ["HELIX", "SPX_SLAYER"],
        needsDeskRead: false,
        needsHistorical: false,
      };

    case "FLOW":
      return {
        depth: "standard",
        required: ["HELIX"], // tape
        optional: ["THERMAL", "NIGHT_HAWK"],
        needsDeskRead: false,
        needsHistorical: false,
      };

    case "MARKET_READ":
      return {
        depth: "deep",
        required: ["HELIX", "THERMAL", "VECTOR", "SPX_SLAYER"], // all major desks
        optional: ["NIGHT_HAWK", "MERIDIAN", "MARKET"],
        needsDeskRead: false,
        needsHistorical: false,
      };

    case "COMPARISON":
      return {
        depth: "standard",
        required: ["HELIX", "THERMAL", "VECTOR"],
        optional: ["SPX_SLAYER", "NIGHT_HAWK"],
        needsDeskRead: false,
        needsHistorical: false,
      };

    case "CHANGE_DETECTION":
      return {
        depth: "standard",
        required: binaryIntent.needsThermalRead ? ["THERMAL"] : ["VECTOR"],
        optional: ["HELIX", "SPX_SLAYER"],
        needsDeskRead: false,
        needsHistorical: false,
      };

    case "TRADE_INTENT":
      return {
        depth: "institutional", // full decision hierarchy
        required: ["HELIX", "THERMAL", "VECTOR", "NIGHT_HAWK"],
        optional: ["SPX_SLAYER", "MERIDIAN", "TRACK_RECORD"],
        needsDeskRead: true, // critical for PLAY/WAIT/NO_TRADE
        needsHistorical: false,
      };

    case "VALIDATION":
      return {
        depth: "standard",
        required: ["TRACK_RECORD"], // grading
        optional: ["NIGHT_HAWK", "SPX_SLAYER"],
        needsDeskRead: false,
        needsHistorical: true, // need grading methodology
      };

    case "WHY":
      return {
        depth: "institutional", // root cause + precedents
        required: ["TRACK_RECORD"], // precedents + grading
        optional: ["HELIX", "THERMAL", "VECTOR", "SPX_SLAYER"],
        needsDeskRead: false,
        needsHistorical: true, // deep historical context
      };

    default:
      return {
        depth: "standard",
        required: ["HELIX", "THERMAL", "VECTOR"],
        optional: ["NIGHT_HAWK", "SPX_SLAYER"],
        needsDeskRead: false,
        needsHistorical: false,
      };
  }
}

/**
 * Gate which tools are worth fetching based on intent category.
 *
 * PRINCIPLE: Fetch ONLY what the answer needs. A QUICK_FACT doesn't need GEX or flow;
 * a MARKET_READ doesn't need historical grading; a WHY doesn't need live tape.
 *
 * This replaces the tool-selection logic in `analyzeLargoQuestion()` with a system
 * where intent drives scope rather than binary flags driving every possible fetch.
 */
export function selectToolsForIntent(
  intentClass: IntentClassification
): {
  required: string[];
  optional: string[];
} {
  const toolMap: Record<LargoProduct, string[]> = {
    SPX_SLAYER: ["get_spx_structure", "get_spx_play", "get_spx_confluence"],
    HELIX: ["get_flow_tape", "get_flow_brief", "get_global_flow"],
    THERMAL: ["get_positioning", "get_gex_heatmap", "get_gex_matrix_changes", "get_gex_regime_events"],
    VECTOR: ["get_vector_full_state", "get_vector_pulse", "get_vector_analytics"],
    NIGHT_HAWK: ["get_zerodte_plays", "get_zerodte_rejections"],
    TRACK_RECORD: ["get_zerodte_record", "get_trade_history", "get_similar_precedents"],
    MARKET: ["get_quote", "get_market_context", "get_technicals"],
    CATALYSTS: ["get_news", "get_earnings"],
    MERIDIAN: ["get_meridian_timeline", "get_meridian_event"],
    PLATFORM: ["get_platform_snapshot", "get_ecosystem_context"],
  };

  const required = intentClass.requiredSystems.flatMap((sys) => toolMap[sys] ?? []);
  const optional = intentClass.optionalSystems.flatMap((sys) => toolMap[sys] ?? []);

  return { required, optional };
}
