import test from "node:test";
import assert from "node:assert/strict";
import {
  initializeMemory,
  updateMemoryWithConsensus,
  updateMemoryWithRegime,
  updateMemoryWithLevels,
  recordDecisionInMemory,
  isMemoryFresh,
  suggestTickerFromQuestion,
  shouldReuseCachedConsensus,
  formatMemoryForSystemPrompt,
  resetMemory,
  type ConversationMemoryState,
} from "./conversation-memory";
import type { ConsensusMatrix } from "./consensus-read-extract";
import type { DeskReadDecision } from "./desk-read-decision";

const mockConsensus: ConsensusMatrix = {
  reads: [
    {
      system: "HELIX",
      direction: "bullish",
      strength: 8,
      basis: "call flow stacking",
      evidence: [],
      asOf: new Date(),
      freshness: "live",
      internalConflict: false,
    },
  ],
  agreement: {
    voting: 1,
    bullish: 1,
    bearish: 0,
    neutral: 0,
    verdict: "bullish",
    direction: "bullish",
    averageStrength: 8,
  },
  contradictions: [],
};

const mockDecision: DeskReadDecision = {
  state: "PLAY",
  ticker: "SPX",
  headline: "🟢 SPX — PLAY",
  thesis: "Bullish consensus",
  trigger: "Break 7650",
  invalidation: "Close below 7600",
  reasoning: "Flow driven",
  strongOpinions: ["HELIX"],
  weakOpinions: [],
  confidence: 0.75,
};

test("initializeMemory returns empty state", () => {
  const memory = initializeMemory();
  assert.strictEqual(memory.ticker, undefined);
  assert.strictEqual(memory.consensus, undefined);
  assert.strictEqual(memory.regime, undefined);
});

test("updateMemoryWithConsensus sets ticker and consensus", () => {
  const memory = initializeMemory();
  const updated = updateMemoryWithConsensus(memory, mockConsensus, "SPX");

  assert.strictEqual(updated.ticker, "SPX");
  assert.ok(updated.consensus);
  assert.strictEqual(updated.consensus.agreement.direction, "bullish");
  assert.ok(updated.lastUpdated);
  assert.strictEqual(updated.dataFreshness, "live");
});

test("updateMemoryWithRegime adds regime context", () => {
  const memory = initializeMemory();
  const updated = updateMemoryWithRegime(memory, "bullish", "dealer gamma long", "THERMAL");

  assert.ok(updated.regime);
  assert.strictEqual(updated.regime.direction, "bullish");
  assert.strictEqual(updated.regime.basis, "dealer gamma long");
  assert.strictEqual(updated.regime.fromSystem, "THERMAL");
});

test("updateMemoryWithLevels stores floor/gate/king + spot", () => {
  const memory = initializeMemory();
  const updated = updateMemoryWithLevels(memory, 7600, 7650, 7750, 7640);

  assert.ok(updated.levels);
  assert.strictEqual(updated.levels.floor, 7600);
  assert.strictEqual(updated.levels.gate, 7650);
  assert.strictEqual(updated.levels.king, 7750);
  assert.strictEqual(updated.levels.spot, 7640);
  assert.ok(updated.levels.asOf);
});

test("recordDecisionInMemory appends decision to history", () => {
  const memory = initializeMemory();
  const updated = recordDecisionInMemory(memory, mockDecision);

  assert.ok(updated.priorDecisions);
  assert.strictEqual(updated.priorDecisions.length, 1);
  assert.strictEqual(updated.priorDecisions[0].state, "PLAY");
  assert.match(updated.priorDecisions[0].reason, /Bullish/);
});

test("recordDecisionInMemory keeps only last 5 decisions", () => {
  let memory = initializeMemory();

  for (let i = 0; i < 7; i++) {
    memory = recordDecisionInMemory(memory, {
      ...mockDecision,
      thesis: `Decision ${i}`,
    });
  }

  assert.strictEqual(memory.priorDecisions!.length, 5);
  assert.match(memory.priorDecisions![0].reason, /Decision 2/);
  assert.match(memory.priorDecisions![4].reason, /Decision 6/);
});

test("isMemoryFresh returns false for empty memory", () => {
  const memory = initializeMemory();
  assert.strictEqual(isMemoryFresh(memory), false);
});

test("isMemoryFresh returns true if updated within 5 min", () => {
  const memory = updateMemoryWithConsensus(initializeMemory(), mockConsensus, "SPX");
  assert.strictEqual(isMemoryFresh(memory), true);
});

test("isMemoryFresh returns false if stale marked explicitly", () => {
  let memory = updateMemoryWithConsensus(initializeMemory(), mockConsensus, "SPX");
  memory.dataFreshness = "stale";
  assert.strictEqual(isMemoryFresh(memory), false);
});

test("isMemoryFresh respects maxAgeSeconds parameter", () => {
  let memory = updateMemoryWithConsensus(initializeMemory(), mockConsensus, "SPX");
  // Manually set lastUpdated to 6 seconds ago
  memory.lastUpdated = new Date(Date.now() - 6000);
  assert.strictEqual(isMemoryFresh(memory, 5), false);
  assert.strictEqual(isMemoryFresh(memory, 10), true);
});

test("suggestTickerFromQuestion extracts explicit ticker", () => {
  const question = "What's the setup on NVDA today?";
  const suggested = suggestTickerFromQuestion(question, initializeMemory());
  assert.strictEqual(suggested, "NVDA");
});

test("suggestTickerFromQuestion reuses cached ticker on short follow-up", () => {
  const memory = updateMemoryWithConsensus(initializeMemory(), mockConsensus, "SPX");
  const shortQuestion = "Levels?";
  const suggested = suggestTickerFromQuestion(shortQuestion, memory);
  assert.strictEqual(suggested, "SPX");
});

test("suggestTickerFromQuestion resets on long substantive question with no ticker", () => {
  const memory = updateMemoryWithConsensus(initializeMemory(), mockConsensus, "SPX");
  const longQuestion = "What are the major macro themes affecting equities right now across different sectors?";
  const suggested = suggestTickerFromQuestion(longQuestion, memory);
  assert.strictEqual(suggested, undefined);
});

test("shouldReuseCachedConsensus returns false if user asks for fresh data", () => {
  const memory = updateMemoryWithConsensus(initializeMemory(), mockConsensus, "SPX");
  const freshQuestion = "What's happening right now?";
  assert.strictEqual(shouldReuseCachedConsensus(freshQuestion, memory), false);
});

test("shouldReuseCachedConsensus returns false if memory is stale", () => {
  let memory = updateMemoryWithConsensus(initializeMemory(), mockConsensus, "SPX");
  // Mark as old
  memory.lastUpdated = new Date(Date.now() - 400000);
  const question = "Tell me more about the consensus";
  assert.strictEqual(shouldReuseCachedConsensus(question, memory), false);
});

test("shouldReuseCachedConsensus returns false if asking about missing system", () => {
  const memory = updateMemoryWithConsensus(initializeMemory(), mockConsensus, "SPX");
  // mockConsensus only has HELIX, ask about THERMAL
  const question = "What's THERMAL saying about gamma?";
  assert.strictEqual(shouldReuseCachedConsensus(question, memory), false);
});

test("shouldReuseCachedConsensus returns true for follow-up on cached system", () => {
  const memory = updateMemoryWithConsensus(initializeMemory(), mockConsensus, "SPX");
  const question = "How strong is the HELIX read?";
  assert.strictEqual(shouldReuseCachedConsensus(question, memory), true);
});

test("shouldReuseCachedConsensus returns false if no consensus cached", () => {
  const memory = initializeMemory();
  const question = "Tell me the consensus";
  assert.strictEqual(shouldReuseCachedConsensus(question, memory), false);
});

test("formatMemoryForSystemPrompt generates context string", () => {
  let memory = updateMemoryWithConsensus(initializeMemory(), mockConsensus, "SPX");
  memory = updateMemoryWithRegime(memory, "bullish", "dealer gamma long");
  memory = updateMemoryWithLevels(memory, 7600, 7650, 7750, 7640);

  const formatted = formatMemoryForSystemPrompt(memory);

  assert.match(formatted, /Conversation Memory \(SPX\)/);
  assert.match(formatted, /Consensus:.*bullish/);
  assert.match(formatted, /Regime:.*bullish/);
  assert.match(formatted, /Levels:.*7600.*7650.*7750/);
  assert.match(formatted, /Spot:.*7640/);
});

test("formatMemoryForSystemPrompt includes prior decision if available", () => {
  let memory = updateMemoryWithConsensus(initializeMemory(), mockConsensus, "SPX");
  memory = recordDecisionInMemory(memory, mockDecision);

  const formatted = formatMemoryForSystemPrompt(memory);

  assert.match(formatted, /Prior Call:.*PLAY/);
  assert.match(formatted, /Bullish consensus/);
});

test("formatMemoryForSystemPrompt returns empty string if no ticker/consensus", () => {
  const memory = initializeMemory();
  const formatted = formatMemoryForSystemPrompt(memory);
  assert.strictEqual(formatted, "");
});

test("resetMemory clears all state", () => {
  let memory = updateMemoryWithConsensus(initializeMemory(), mockConsensus, "SPX");
  memory = updateMemoryWithLevels(memory, 7600, 7650, 7750);
  memory = recordDecisionInMemory(memory, mockDecision);

  const reset = resetMemory();

  assert.strictEqual(reset.ticker, undefined);
  assert.strictEqual(reset.consensus, undefined);
  assert.strictEqual(reset.levels, undefined);
  assert.strictEqual(reset.priorDecisions, undefined);
});

test("memory updates compose correctly", () => {
  let memory = initializeMemory();
  memory = updateMemoryWithConsensus(memory, mockConsensus, "SPX");
  memory = updateMemoryWithRegime(memory, "bullish", "tape driven");
  memory = updateMemoryWithLevels(memory, 7600, 7650, 7750, 7640);
  memory = recordDecisionInMemory(memory, mockDecision);

  // Verify all state is present
  assert.strictEqual(memory.ticker, "SPX");
  assert.ok(memory.consensus);
  assert.ok(memory.regime);
  assert.ok(memory.levels);
  assert.ok(memory.priorDecisions);
  assert.strictEqual(memory.dataFreshness, "live");
  assert.ok(memory.lastUpdated);
});
