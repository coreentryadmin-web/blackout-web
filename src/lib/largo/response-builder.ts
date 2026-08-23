/**
 * RESPONSE BUILDER — ties Phase 1 (intent + consensus + decision) to Phase 2b (components).
 *
 * This module shows how to build complete Largo answers with structured components.
 * It orchestrates:
 * 1. Intent classification (phase 1) → what depth and scope
 * 2. Consensus extraction (phase 1) → multi-system matrix
 * 3. Desk-read decision (phase 1) → PLAY/WAIT/NO_TRADE
 * 4. Visual components (phase 2b) → JSON for rendering
 * 5. Answer structure (BieAnswerEnvelope) → what to populate
 *
 * Example workflow:
 * ```
 * const orchestrated = await orchestrateAdaptiveResponse(question, history);
 * const toolResults = await fetchTools(orchestrated.selectedTools.required);
 * const enriched = await enrichWithConsensus(orchestrated, toolResults, ticker);
 * const components = buildResponseComponents(enriched, question);
 * const envelope = buildAnswerStructure(enriched, headline);
 * // Now render components inline in the envelope
 * ```
 */

import type { OrchestrationResult } from "@/lib/largo/adaptive-response-orchestrator";
import {
  buildConsensusComponent,
  buildLevelsComponent,
  buildTradeDecisionComponent,
  buildEvidenceComponent,
  buildRiskComponent,
  buildConsensusHeader,
  type BlackoutComponent,
} from "@/lib/largo/visual-component-builder";

export interface ResponseComponents {
  /** Header component (if MARKET_READ or TRADE_INTENT). */
  header?: BlackoutComponent;
  /** Consensus comparison component for Facts section. */
  consensus?: BlackoutComponent;
  /** Price levels component for Facts section. */
  levels?: BlackoutComponent;
  /** Evidence of bullish vs bearish signals. */
  evidence?: BlackoutComponent;
  /** Trade decision callout (PLAY/WAIT/NO_TRADE). */
  decision?: BlackoutComponent;
  /** Risk/invalidation component. */
  risk?: BlackoutComponent;
  /** Raw components array for rendering inline. */
  components: BlackoutComponent[];
}

/**
 * Build Blackout components from orchestrated response data.
 *
 * Component selection is gated by intent category:
 * - QUICK_FACT: No components (prose only)
 * - LEVEL_STRUCTURE: levels component
 * - FLOW: no components (described in prose)
 * - MARKET_READ: header + consensus + evidence
 * - COMPARISON: consensus component (for both sides)
 * - CHANGE_DETECTION: no components (described in prose)
 * - TRADE_INTENT: header + consensus + decision + risk
 * - VALIDATION: no components (prose outcome)
 * - WHY: evidence + risk components
 */
export function buildResponseComponents(orchestrated: OrchestrationResult, headline: string): ResponseComponents {
  const components: BlackoutComponent[] = [];
  const category = orchestrated.intentCategory.category;
  const { consensus, deskRead } = orchestrated;

  // Header component for MARKET_READ and TRADE_INTENT
  let header: BlackoutComponent | undefined;
  if ((category === "MARKET_READ" || category === "TRADE_INTENT") && consensus.reads.length > 0) {
    header = buildConsensusHeader(consensus, headline);
    components.push(header);
  }

  // Consensus comparison for multi-system reads
  let consensusComponent: BlackoutComponent | undefined;
  if (
    (category === "MARKET_READ" || category === "COMPARISON" || category === "TRADE_INTENT") &&
    consensus.reads.length > 0
  ) {
    consensusComponent = buildConsensusComponent(consensus);
    components.push(consensusComponent);
  }

  // Levels component for LEVEL_STRUCTURE and TRADE_INTENT
  let levelsComponent: BlackoutComponent | undefined;
  if ((category === "LEVEL_STRUCTURE" || (category === "TRADE_INTENT" && deskRead?.state)) && orchestrated.toolResults) {
    // Extract levels and spot from tool results
    const toolResults = orchestrated.toolResults;
    const levels = {
      floor: toolResults.positioning?.put_wall ?? 0,
      gate: toolResults.positioning?.spot ?? toolResults.get_quote?.current_price ?? 0,
      king: toolResults.positioning?.call_wall ?? 0,
    };
    const spot = toolResults.get_quote?.current_price;

    if (levels.floor || levels.gate || levels.king) {
      levelsComponent = buildLevelsComponent(levels, spot);
      components.push(levelsComponent);
    }
  }

  // Evidence of bullish/bearish signals
  let evidenceComponent: BlackoutComponent | undefined;
  if ((category === "MARKET_READ" || category === "WHY" || category === "TRADE_INTENT") && consensus.reads.length > 0) {
    evidenceComponent = buildEvidenceComponent(consensus);
    if (evidenceComponent) {
      components.push(evidenceComponent);
    }
  }

  // Trade decision for TRADE_INTENT
  let decisionComponent: BlackoutComponent | undefined;
  if (category === "TRADE_INTENT" && deskRead) {
    decisionComponent = buildTradeDecisionComponent(deskRead);
    components.push(decisionComponent);
  }

  // Risk/invalidation component
  let riskComponent: BlackoutComponent | undefined;
  if ((category === "TRADE_INTENT" || category === "WHY") && deskRead) {
    riskComponent = buildRiskComponent(deskRead);
    components.push(riskComponent);
  }

  return {
    header,
    consensus: consensusComponent,
    levels: levelsComponent,
    evidence: evidenceComponent,
    decision: decisionComponent,
    risk: riskComponent,
    components,
  };
}

/**
 * Format components as inline Blackout JSON blocks for embedding in answer.
 * Each component becomes a fenced code block with JSON.
 *
 * Example output:
 * ```
 * ```blackout
 * { "type": "comparison", "title": "Multi-system consensus", ... }
 * ```
 * ```
 */
export function formatComponentsAsMarkdown(components: BlackoutComponent[]): string {
  if (components.length === 0) return "";

  const blocks = components.map((component) => {
    const json = JSON.stringify(component, null, 2);
    return `\`\`\`blackout\n${json}\n\`\`\``;
  });

  return blocks.join("\n\n");
}
