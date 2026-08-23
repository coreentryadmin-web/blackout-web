/**
 * CONVERSATION MEMORY — analytical context retention across turns.
 *
 * Largo's power is multi-turn analysis: ask about the tape, then ask about regime,
 * then ask about setup validation — each question refines the picture. But without
 * memory, each turn restarts: new tools fetched, new consensus extracted, new regime
 * inferred. Same data, built three times.
 *
 * This module holds:
 * 1. **Ticker/subject** — the current instrument being analyzed (SPX, QQQ, NVDA)
 * 2. **Consensus matrix** — multi-system reads cached so follow-ups don't re-fetch
 * 3. **Regime anchor** — market regime (bullish/bearish/conflicted) + supporting data
 * 4. **Price context** — current levels (support/gate/target) and spot price
 * 5. **Decision history** — prior PLAY/WAIT/NO_TRADE calls on this ticker
 * 6. **Fresh marker** — timestamp for data freshness (live, 1-min lag, session-stale)
 *
 * Memory lifecycle:
 * - **Acquire:** On first question mentioning ticker → fetch full consensus + regime
 * - **Reuse:** On follow-up question without ticker mention → use cached ticker
 * - **Update:** On explicit regime/level change → refresh just that component
 * - **Expire:** After 5 min or user asks different ticker → reset
 */

import type { ConsensusMatrix } from "./consensus-read-extract";
import type { DeskReadDecision } from "./desk-read-decision";
import { etClock } from "@/lib/et-clock";

export interface ConversationMemoryState {
  /** Current instrument being analyzed (e.g. "SPX", "QQQ", "NVDA") */
  ticker?: string;
  /** Multi-system consensus from last fetch. */
  consensus?: ConsensusMatrix;
  /** Market regime (bullish/bearish/conflicted) + why. */
  regime?: {
    direction: "bullish" | "bearish" | "conflicted" | null;
    basis: string; // e.g. "dealer gamma long"
    fromSystem?: string; // which system provided this regime read
  };
  /** Price context (floor/gate/king) + current spot. */
  levels?: {
    floor: number;
    gate: number;
    king: number;
    spot?: number;
    asOf?: Date;
  };
  /** Prior desk read decisions on this ticker. */
  priorDecisions?: Array<{
    state: "PLAY" | "WAIT" | "NO_TRADE";
    reason: string;
    timestamp: Date;
  }>;
  /** When this memory was last updated. */
  lastUpdated?: Date;
  /** Data freshness: live, 1-min lag, session-stale */
  dataFreshness?: "live" | "cached" | "stale";
}

/**
 * Initialize or reset conversation memory.
 */
export function initializeMemory(): ConversationMemoryState {
  return {};
}

/**
 * Update memory with new consensus data.
 * Called after consensus extraction (enrichWithConsensus).
 */
export function updateMemoryWithConsensus(
  memory: ConversationMemoryState,
  consensus: ConsensusMatrix,
  ticker: string
): ConversationMemoryState {
  return {
    ...memory,
    ticker,
    consensus,
    lastUpdated: new Date(),
    dataFreshness: "live",
  };
}

/**
 * Update memory with regime change.
 * Called when regime is detected or explicitly asked about.
 */
export function updateMemoryWithRegime(
  memory: ConversationMemoryState,
  direction: "bullish" | "bearish" | "conflicted" | null,
  basis: string,
  fromSystem?: string
): ConversationMemoryState {
  return {
    ...memory,
    regime: {
      direction,
      basis,
      fromSystem,
    },
    lastUpdated: new Date(),
  };
}

/**
 * Update memory with price levels.
 * Called when levels are extracted from tools.
 */
export function updateMemoryWithLevels(
  memory: ConversationMemoryState,
  floor: number,
  gate: number,
  king: number,
  spot?: number
): ConversationMemoryState {
  return {
    ...memory,
    levels: {
      floor,
      gate,
      king,
      spot,
      asOf: new Date(),
    },
    lastUpdated: new Date(),
  };
}

/**
 * Record a desk read decision in memory.
 * Allows "how was my prior call?" follow-ups.
 */
export function recordDecisionInMemory(
  memory: ConversationMemoryState,
  decision: DeskReadDecision
): ConversationMemoryState {
  const priorDecisions = memory.priorDecisions ?? [];
  priorDecisions.push({
    state: decision.state,
    reason: decision.thesis,
    timestamp: new Date(),
  });

  // Keep only last 5 decisions to avoid unbounded growth
  if (priorDecisions.length > 5) {
    priorDecisions.shift();
  }

  return {
    ...memory,
    priorDecisions,
    lastUpdated: new Date(),
  };
}

/**
 * Check if memory is still fresh (live data, not stale).
 * Data is considered stale after 5 minutes or if explicitly marked so.
 */
export function isMemoryFresh(memory: ConversationMemoryState, maxAgeSeconds = 300): boolean {
  if (!memory.lastUpdated) return false;
  if (memory.dataFreshness === "stale") return false;

  const ageSeconds = (Date.now() - memory.lastUpdated.getTime()) / 1000;
  return ageSeconds < maxAgeSeconds;
}

/**
 * Suggest whether this question should reuse cached ticker or ask for new one.
 *
 * Heuristic:
 * - Question mentions a ticker explicitly → use that ticker (clear intent)
 * - Question is a follow-up (no ticker, short) → reuse current ticker
 * - Question is too different (different systems, different time frame) → reset
 */
export function suggestTickerFromQuestion(
  question: string,
  currentMemory: ConversationMemoryState
): string | undefined {
  // Look for ticker pattern: A-Z{1,4} at word boundary
  const tickerMatch = question.match(/\b([A-Z]{1,5})\b/);
  if (tickerMatch) {
    return tickerMatch[1]; // Explicit ticker in question
  }

  // Check if this is a short follow-up (likely same ticker)
  if (question.length < 40 && currentMemory.ticker) {
    return currentMemory.ticker; // Reuse cached ticker
  }

  // Question is substantive and no ticker → reset
  return undefined;
}

/**
 * Suggest whether to re-fetch tools or reuse cached consensus.
 *
 * Reuse cached if:
 * - Memory is fresh (< 5 min old)
 * - Same ticker
 * - Question is about consensus/interpretation (not new regime/levels)
 *
 * Refresh if:
 * - Memory is stale (> 5 min old)
 * - User explicitly asks for update ("what now?", "live read")
 * - Ticker changed
 * - Different system is being asked about (e.g. asking THERMAL after only seeing HELIX)
 */
export function shouldReuseCachedConsensus(
  question: string,
  currentMemory: ConversationMemoryState
): boolean {
  // Explicit refresh signals
  if (
    question.match(/what.*?(?:now|right now|currently)/i) ||
    question.match(/latest|live|fresh|updated/i) ||
    question.match(/again|re-check/i)
  ) {
    return false; // User wants fresh data
  }

  // If memory is stale, refresh
  if (!isMemoryFresh(currentMemory)) {
    return false;
  }

  // If no consensus cached, can't reuse
  if (!currentMemory.consensus) {
    return false;
  }

  // If asking about something not in cache (e.g. MERIDIAN when only HELIX present), refresh
  const askedSystems = question.match(/helix|thermal|vector|meridian|nighthawk|slayer/gi);
  if (askedSystems) {
    const cachedSystems = new Set(currentMemory.consensus.reads.map((r) => r.system.toUpperCase()));
    const allCovered = askedSystems.every((system) => cachedSystems.has(system.toUpperCase()));
    if (!allCovered) {
      return false; // Missing system, need refresh
    }
  }

  return true; // Reuse cache
}

/**
 * Format memory state as a context string for the system prompt.
 * Embeds ticker, consensus summary, and prior decisions.
 */
export function formatMemoryForSystemPrompt(memory: ConversationMemoryState): string {
  if (!memory.ticker || !memory.consensus) return "";

  const lines: string[] = [];
  lines.push(`## Conversation Memory (${memory.ticker})`);
  lines.push("");

  // Consensus summary
  const { agreement } = memory.consensus;
  lines.push(
    `**Consensus:** ${agreement.direction || "mixed"} (${agreement.voting} systems, ${agreement.averageStrength.toFixed(1)}/10 strength)`
  );

  // Regime if available
  if (memory.regime?.direction) {
    lines.push(`**Regime:** ${memory.regime.direction} (${memory.regime.basis})`);
  }

  // Price levels if available
  if (memory.levels?.floor) {
    lines.push(`**Levels:** Floor ${memory.levels.floor} · Gate ${memory.levels.gate} · King ${memory.levels.king}`);
    if (memory.levels.spot) {
      lines.push(`**Spot:** ${memory.levels.spot}`);
    }
  }

  // Prior decisions if available
  if (memory.priorDecisions && memory.priorDecisions.length > 0) {
    const lastDecision = memory.priorDecisions[memory.priorDecisions.length - 1];
    lines.push(
      `**Prior Call:** ${lastDecision.state} — ${lastDecision.reason} (${etClock(lastDecision.timestamp) || "timestamp unavailable"})`
    );
  }

  // Data freshness
  lines.push(`**Freshness:** ${memory.dataFreshness || "unknown"} (${etClock(memory.lastUpdated) || "no timestamp"})`);

  lines.push("");
  return lines.join("\n");
}

/**
 * Reset memory (e.g., when user changes subjects or after session timeout).
 */
export function resetMemory(): ConversationMemoryState {
  return initializeMemory();
}
