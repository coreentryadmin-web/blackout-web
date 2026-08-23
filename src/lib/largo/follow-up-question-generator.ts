/**
 * FOLLOW-UP QUESTION GENERATOR — suggests next questions based on unresolved context.
 *
 * After answering a question, what is the reader left wanting to know?
 * This module identifies gaps: missing systems, unresolved decisions, untested precedent.
 *
 * Follow-ups are surfaced in priority order:
 * 1. **Decision validation** — if TRADE_INTENT WAIT, ask what would trigger
 * 2. **System gap** — if one major system is missing from consensus
 * 3. **Conflict resolution** — if MARKET_READ has disagreement, ask which side is stronger
 * 4. **Time/regime check** — if deep data is absent, ask about precedent
 * 5. **Depth upgrade** — if minimal answer was given, offer deeper variant
 */

import type { QuestionIntentCategory } from "./question-intent-category";
import type { OrchestrationResult } from "./adaptive-response-orchestrator";
import type { ConsensusMatrix } from "./consensus-read-extract";
import type { DeskReadDecision } from "./desk-read-decision";
import type { LargoProduct } from "./registry/capability-registry";

export interface FollowUpSuggestion {
  /** The suggested question text */
  question: string;
  /** Why this follow-up matters now (brief reason) */
  reason: string;
  /** Intent category this question would trigger */
  suggestedIntent: QuestionIntentCategory;
  /** Priority: 1=critical, 2=important, 3=nice-to-have */
  priority: 1 | 2 | 3;
  /** The missing context that makes this relevant */
  gapType: "decision" | "system" | "conflict" | "precedent" | "depth";
}

/**
 * Generate follow-up questions for the current answer.
 * Analyzes orchestration result and suggests what to ask next.
 */
export function suggestFollowUpQuestions(
  orchestrated: OrchestrationResult,
  question: string,
  deskRead?: DeskReadDecision
): FollowUpSuggestion[] {
  const suggestions: FollowUpSuggestion[] = [];
  const category = orchestrated.intentCategory.category;
  const consensus = orchestrated.consensus;

  /**
   * DECISION VALIDATION — if the answer was WAIT, ask what resolves it
   */
  if (category === "TRADE_INTENT" && deskRead?.state === "WAIT") {
    suggestions.push({
      question: `What would confirm the thesis for ${deskRead.ticker}?`,
      reason: "Decision is WAIT — reader needs clarity on the gate.",
      suggestedIntent: "VALIDATION",
      priority: 1,
      gapType: "decision",
    });
  }

  /**
   * DECISION VALIDATION — if PLAY, ask about invalidation precision
   */
  if (category === "TRADE_INTENT" && deskRead?.state === "PLAY" && !deskRead.invalidation) {
    suggestions.push({
      question: `What level stops the ${deskRead.ticker} thesis?`,
      reason: "PLAY decision stated but invalidation unclear.",
      suggestedIntent: "TRADE_INTENT",
      priority: 2,
      gapType: "decision",
    });
  }

  /**
   * SYSTEM GAP — which major systems are missing from consensus
   */
  const systemsRead = new Set(consensus.reads.map((r) => r.system));
  const majorSystems = ["HELIX", "THERMAL", "VECTOR", "SPX_SLAYER", "MERIDIAN", "NIGHT_HAWK"] as const;
  const missingMajor = majorSystems.filter((s) => !systemsRead.has(s));

  if (missingMajor.length > 0 && (category === "MARKET_READ" || category === "COMPARISON")) {
    suggestions.push({
      question: `What's ${missingMajor[0].replace(/_/g, " ").toLowerCase()} saying?`,
      reason: `${missingMajor[0]} not consulted — fills the consensus picture.`,
      suggestedIntent: "MARKET_READ",
      priority: 2,
      gapType: "system",
    });
  }

  /**
   * CONFLICT RESOLUTION — if multiple systems disagree, ask which is stronger
   */
  if (consensus.contradictions.length > 0 && category !== "WHY") {
    const firstConflict = consensus.contradictions[0];
    suggestions.push({
      question: `In the ${firstConflict.pair} conflict, which signal is more reliable now?`,
      reason: `Systems disagree on direction — reader needs tiebreaker.`,
      suggestedIntent: "COMPARISON",
      priority: 2,
      gapType: "conflict",
    });
  }

  /**
   * FLOW GAP — if no flow read was included, ask for tape
   */
  if (
    category === "MARKET_READ" &&
    !consensus.reads.some((r) => r.system === "HELIX")
  ) {
    suggestions.push({
      question: `What does the tape (flow) show for the levels?`,
      reason: "Consensus is structural — tape would ground it in real participants.",
      suggestedIntent: "FLOW",
      priority: 3,
      gapType: "system",
    });
  }

  /**
   * PRECEDENT GAP — if a heavy read is given, ask if this has happened before
   */
  if (consensus.agreement.averageStrength >= 7 && category !== "WHY") {
    const ticker = question.match(/\b([A-Z]{1,5})\b/)?.[1] || "this level";
    suggestions.push({
      question: `Has ${ticker} seen this consensus pattern before? How did it play?`,
      reason: `Strong consensus is being stated — precedent would show if it's reliable.`,
      suggestedIntent: "WHY",
      priority: 3,
      gapType: "precedent",
    });
  }

  /**
   * INVALIDATION DETAIL — if decision is PLAY but invalidation is vague
   */
  if (
    category === "TRADE_INTENT" &&
    deskRead?.state === "PLAY" &&
    deskRead.invalidation &&
    deskRead.invalidation.length < 15
  ) {
    suggestions.push({
      question: `How certain is the ${deskRead.invalidation} level — what's the downside risk there?`,
      reason: "Invalidation is the stop — needs precision.",
      suggestedIntent: "LEVEL_STRUCTURE",
      priority: 2,
      gapType: "decision",
    });
  }

  /**
   * DEPTH UPGRADE — if question was minimal, offer standard variant
   */
  if (orchestrated.intentCategory.responseDepth === "minimal") {
    suggestions.push({
      question: `Tell me more about this.`,
      reason: "Deeper context available — reader may want the full picture.",
      suggestedIntent: category,
      priority: 3,
      gapType: "depth",
    });
  }

  /**
   * REGIME CONTEXT — if levels are mentioned but regime is not
   */
  if (category === "LEVEL_STRUCTURE" && consensus.reads.length === 0) {
    suggestions.push({
      question: `What regime do these levels define?`,
      reason: "Levels are stated — regime context explains their significance.",
      suggestedIntent: "MARKET_READ",
      priority: 3,
      gapType: "system",
    });
  }

  /**
   * ALTERNATIVE THESIS — if decision is NO_TRADE, ask about the opposite
   */
  if (category === "TRADE_INTENT" && deskRead?.state === "NO_TRADE") {
    suggestions.push({
      question: `What would make the bearish case here?`,
      reason: "If bullish case is weak, the bearish read might be higher conviction.",
      suggestedIntent: "MARKET_READ",
      priority: 3,
      gapType: "conflict",
    });
  }

  // Sort by priority (1 first) then by gap type predictability
  const priorityOrder = { decision: 0, system: 1, conflict: 2, precedent: 3, depth: 4 };
  suggestions.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return priorityOrder[a.gapType] - priorityOrder[b.gapType];
  });

  return suggestions;
}

/**
 * Format follow-up suggestions as a comma-separated "next questions" list.
 * Use this in the UI to suggest clickable follow-ups.
 */
export function formatFollowUpSuggestions(suggestions: FollowUpSuggestion[]): string {
  if (!suggestions.length) return "";

  // Take top 3 suggestions, format as list
  return suggestions
    .slice(0, 3)
    .map((s) => `"${s.question}"`)
    .join(" • ");
}
