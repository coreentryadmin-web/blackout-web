/**
 * ADAPTIVE RESPONSE ORCHESTRATOR — ties intent, consensus, and desk read into unified response.
 *
 * PIPELINE:
 * 1. Question comes in → detectIntentCategory()
 * 2. Intent drives selectToolsForIntent() → minimal tool set
 * 3. Tools called, results captured
 * 4. extractConsensusFromTools() → ConsensusMatrix
 * 5. evaluateDeskRead() → PLAY/WAIT/NO_TRADE decision
 * 6. Populate BieAnswerEnvelope with intent, consensus, desk read, depth-gated sections
 * 7. Render based on responseDepth (minimal/standard/deep/institutional)
 *
 * Key insight: This orchestrator builds the DATA MODEL FIRST, then the prose follows.
 * Streaming, templates, and markdown rendering happen LATER.
 */

import type { AnthropicMessage } from "@/lib/providers/anthropic";
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import { detectIntentCategory, selectToolsForIntent, type IntentClassification } from "./question-intent-category";
import { extractConsensusFromTools, type ConsensusMatrix } from "./consensus-read-extract";
import { evaluateDeskRead, type DeskReadDecision } from "./desk-read-decision";
import { analyzeLargoQuestion } from "./question-intent";

export type OrchestrationResult = {
  /** What intent category this question was classified as. */
  intentCategory: IntentClassification;
  /** Multi-system consensus matrix. */
  consensus: ConsensusMatrix;
  /** PLAY/WAIT/NO_TRADE desk read decision. */
  deskRead?: DeskReadDecision;
  /** Which tools should be fetched (optimized for intent). */
  selectedTools: {
    required: string[];
    optional: string[];
  };
  /** Target envelope population (what sections to include). */
  envelopeStructure: {
    headlineOnly: boolean;
    includeSystemReads: boolean;
    includeLevels: boolean;
    includeDeskRead: boolean;
    includeScenarios: boolean;
    includeFollowUps: boolean;
  };
  /** Tool results (populated after tool invocation). Optional for backward compatibility. */
  toolResults?: Record<string, any>;
};

/**
 * Orchestrate the adaptive response pipeline.
 *
 * This is called BEFORE tool invocation, to answer: "What should we fetch and how deep should we go?"
 *
 * Example:
 * ```
 * const result = await orchestrateAdaptiveResponse(
 *   "What's the desk read on SPX right now?",
 *   history
 * );
 * // result.selectedTools tells us what to fetch (HELIX tape, THERMAL GEX, etc.)
 * // result.intentCategory.responseDepth tells renderer how much detail to include
 *
 * // ... fetch tools ...
 * const toolResults = await fetchTools(result.selectedTools.required);
 *
 * // ... populate envelope ...
 * const envelope = populateEnvelope(result, toolResults);
 * ```
 */
export async function orchestrateAdaptiveResponse(
  question: string,
  history: AnthropicMessage[]
): Promise<OrchestrationResult> {
  // Step 1: Detect intent category
  const binaryIntent = analyzeLargoQuestion(question, history);
  const intentCategory = detectIntentCategory(question, binaryIntent);

  // Step 2: Select tools based on intent
  const selectedTools = selectToolsForIntent(intentCategory);

  // Step 3: Determine envelope structure based on depth
  const envelopeStructure = mapDepthToEnvelopeStructure(intentCategory.responseDepth);

  // Step 4: Build orchestration result (ready to fetch tools)
  return {
    intentCategory,
    consensus: { reads: [], agreement: { voting: 0, bullish: 0, bearish: 0, neutral: 0, verdict: "neutral", direction: null, averageStrength: 0 }, contradictions: [] },
    selectedTools,
    envelopeStructure,
  };
}

/**
 * Post-tool-fetch: extract consensus and desk read.
 *
 * Called AFTER tools return, to synthesize the structured answer.
 *
 * Example:
 * ```
 * const toolResults = await fetchTools(result.selectedTools.required);
 * const enriched = await enrichWithConsensus(result, toolResults, "SPX");
 * // enriched.consensus is now populated
 * // enriched.deskRead is now populated (if applicable)
 * ```
 */
export async function enrichWithConsensus(
  orchestration: OrchestrationResult,
  toolResults: Record<string, any>,
  ticker: string
): Promise<OrchestrationResult> {
  // Step 1: Extract consensus from tool results
  const consensus = extractConsensusFromTools(toolResults);

  // Step 2: Evaluate desk read if applicable
  let deskRead: DeskReadDecision | undefined;
  if (orchestration.intentCategory.needsDeskRead) {
    const context = {
      consensus,
      levels: extractLevels(toolResults, ticker),
      regime: extractRegime(toolResults),
      regimeAlignment: checkRegimeAlignment(consensus, toolResults),
      tapeBias: extractTapeBias(consensus),
      spot: toolResults.get_quote?.current_price ?? undefined,
      isEventDay: checkEventDay(toolResults),
    };
    deskRead = evaluateDeskRead(context, ticker);
  }

  return {
    ...orchestration,
    consensus,
    deskRead,
    toolResults,
  };
}

/**
 * Convert orchestration result into BieAnswerEnvelope structure.
 *
 * This DOES NOT generate prose; it creates the structured data model that the UI
 * and prose renderer both consume.
 */
export function buildAnswerStructure(orchestration: OrchestrationResult, headline: string): Partial<BieAnswerEnvelope> {
  const envelope: Partial<BieAnswerEnvelope> = {
    headline,
    bias: orchestration.consensus.agreement.direction === "bullish" ? "bullish" : orchestration.consensus.agreement.direction === "bearish" ? "bearish" : "neutral",
    intent: orchestration.intentCategory.category,
    sections: [],
    evidence: [],
  };

  // Populate systemReads from consensus (this is NEW — was never populated before)
  if (orchestration.envelopeStructure.includeSystemReads && orchestration.consensus.reads.length > 0) {
    envelope.systemReads = {
      reads: orchestration.consensus.reads.map((read) => ({
        system: read.system.toLowerCase().replace(/_/g, "-"),
        kind: "directional",
        stance: read.direction,
        strength: read.strength,
        basis: read.basis,
        reason: read.evidence?.join("; "),
      })),
      agreement: {
        voting: orchestration.consensus.agreement.voting,
        bullish: orchestration.consensus.agreement.bullish,
        bearish: orchestration.consensus.agreement.bearish,
        neutral: orchestration.consensus.agreement.neutral,
        verdict: orchestration.consensus.agreement.verdict,
        direction: orchestration.consensus.agreement.direction,
      },
    };
  }

  // Populate deskRead (this is NEW)
  if (orchestration.envelopeStructure.includeDeskRead && orchestration.deskRead) {
    const decision = orchestration.deskRead;
    envelope.tradeDecision = {
      ticker: decision.ticker,
      actionLabel: decision.state === "PLAY" ? "ENTER" : decision.state === "WAIT" ? "WAIT FOR TRIGGER" : "STAND ASIDE",
      signalRows: [
        {
          signal: decision.thesis,
          read: decision.reasoning,
          bias: decision.state === "PLAY" ? "bullish" : decision.state === "NO_TRADE" ? "bearish" : "neutral",
          glyph: decision.state === "PLAY" ? "🟢" : decision.state === "WAIT" ? "🟡" : "🔴",
        },
      ],
    };

    if (decision.trigger) {
      envelope.tradeDecision!.signalRows!.push({
        signal: "Trigger",
        read: decision.trigger,
        bias: "neutral",
        glyph: "→",
      });
    }

    if (decision.invalidation) {
      envelope.invalidation = decision.invalidation;
    }
  }

  return envelope;
}

// ── Helper functions ──

function mapDepthToEnvelopeStructure(depth: string): OrchestrationResult["envelopeStructure"] {
  switch (depth) {
    case "minimal":
      return {
        headlineOnly: true,
        includeSystemReads: false,
        includeLevels: false,
        includeDeskRead: false,
        includeScenarios: false,
        includeFollowUps: false,
      };
    case "standard":
      return {
        headlineOnly: false,
        includeSystemReads: true,
        includeLevels: true,
        includeDeskRead: false,
        includeScenarios: false,
        includeFollowUps: true,
      };
    case "deep":
      return {
        headlineOnly: false,
        includeSystemReads: true,
        includeLevels: true,
        includeDeskRead: true,
        includeScenarios: true,
        includeFollowUps: true,
      };
    case "institutional":
      return {
        headlineOnly: false,
        includeSystemReads: true,
        includeLevels: true,
        includeDeskRead: true,
        includeScenarios: true,
        includeFollowUps: true,
      };
    default:
      return {
        headlineOnly: false,
        includeSystemReads: true,
        includeLevels: true,
        includeDeskRead: false,
        includeScenarios: false,
        includeFollowUps: true,
      };
  }
}

function extractLevels(toolResults: Record<string, any>, ticker: string) {
  // Extract support/resistance from tool results
  const positioning = toolResults.get_positioning;
  const gexHeatmap = toolResults.get_gex_heatmap;

  if (!positioning && !gexHeatmap) return undefined;

  // Simplified extraction — real implementation would parse matrix data
  return {
    floor: positioning?.put_wall ?? 0,
    gate: positioning?.spot ?? 0,
    king: positioning?.call_wall ?? 0,
  };
}

/**
 * Market regime — used by `checkRegimeAlignment` to gate PLAY vs NO_TRADE in
 * `desk-read-decision.ts` (a "counter-regime" read blocks PLAY and adds a NO_TRADE reason).
 *
 * DEALER GAMMA POSTURE IS NOT A DIRECTIONAL MARKET REGIME. This used to infer "bullish"/"bearish"
 * off `get_positioning`'s posture — short gamma amplifies a move in EITHER direction and long
 * gamma dampens a move in EITHER direction, so calling either one "bullish" or "bearish" asserts
 * something the GEX matrix never measured. This is the same root cause as the live P0 (#2422)
 * `contract/product-adapters.ts::thermalContribution` was written to fix (Thermal casts NO
 * directional vote there, on purpose) and the near-identical bug in `consensus-read-extract.ts`'s
 * `extractThermalRead` (fixed alongside this one) — a fabricated regime here gated real trade
 * decisions exactly like a fabricated consensus vote there.
 *
 * It also compared the WRONG field: the real payload has no `gamma_flip` string — `flip` is a
 * numeric strike level and the posture enum is `gamma_posture: "long" | "short" | null`. So on
 * real data this silently never fired (`undefined` both times); it only fired on a payload shaped
 * with the old bogus field, which is precisely how it slipped by. There is no honest way to derive
 * a directional regime from GEX posture, so this no longer tries — only an explicit
 * `get_market_regime` tool result can set a regime.
 */
export function extractRegime(toolResults: Record<string, any>): string | undefined {
  const regime = toolResults.get_market_regime;
  if (regime) return regime.regime ?? regime.name;
  return undefined;
}

function checkRegimeAlignment(consensus: ConsensusMatrix, toolResults: Record<string, any>): "aligned" | "counter" | "neutral" {
  // Is the consensus direction aligned with the market regime?
  const regime = extractRegime(toolResults);
  const direction = consensus.agreement.direction;

  if (!regime || !direction) return "neutral";

  if ((regime === "bullish" && direction === "bullish") || (regime === "bearish" && direction === "bearish")) {
    return "aligned";
  }

  return "counter";
}

function extractTapeBias(consensus: ConsensusMatrix): "bullish" | "bearish" | "mixed" | undefined {
  const helixRead = consensus.reads.find((r) => r.system === "HELIX");
  if (!helixRead) return undefined;

  if (helixRead.direction === "bullish") return "bullish";
  if (helixRead.direction === "bearish") return "bearish";
  return "mixed";
}

function checkEventDay(toolResults: Record<string, any>): boolean {
  const calendar = toolResults.get_economic_calendar;
  const earnings = toolResults.get_earnings;

  if (calendar?.events?.length > 0) return true;
  if (earnings?.upcoming?.length > 0) return true;

  return false;
}
