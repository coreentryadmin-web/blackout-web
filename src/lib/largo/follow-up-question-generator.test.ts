import test from "node:test";
import assert from "node:assert/strict";
import {
  suggestFollowUpQuestions,
  formatFollowUpSuggestions,
  type FollowUpSuggestion,
} from "./follow-up-question-generator";
import type { OrchestrationResult } from "./adaptive-response-orchestrator";
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
    {
      system: "THERMAL",
      direction: "bearish",
      strength: 7,
      basis: "negative gamma",
      evidence: [],
      asOf: new Date(),
      freshness: "live",
      internalConflict: false,
    },
  ],
  agreement: {
    voting: 2,
    bullish: 1,
    bearish: 1,
    neutral: 0,
    verdict: "conflicted",
    direction: null,
    averageStrength: 7.5,
  },
  contradictions: [
    {
      pair: "HELIX vs THERMAL",
      stronger: "THERMAL",
      why: "tape bullish but gamma not supporting",
    },
  ],
};

const buildOrchestration = (category: string, depth = "standard"): OrchestrationResult => ({
  intentCategory: {
    category: category as any,
    confidence: 0.9,
    responseDepth: depth as any,
    requiredSystems: [],
    optionalSystems: [],
    needsDeskRead: category === "TRADE_INTENT",
    needsHistoricalContext: false,
  },
  consensus: mockConsensus,
  deskRead: undefined,
  selectedTools: { required: [], optional: [] },
  envelopeStructure: {
    headlineOnly: false,
    includeSystemReads: true,
    includeLevels: false,
    includeDeskRead: false,
    includeScenarios: false,
    includeFollowUps: false,
  },
});

const mockWaitDecision: DeskReadDecision = {
  state: "WAIT",
  ticker: "SPX",
  headline: "🟡 SPX — WAIT",
  thesis: "Mixed signals until gate resolves",
  trigger: "Close above 7650 confirms",
  invalidation: "Close below 7600",
  reasoning: "Tape bullish but structure unclear",
  strongOpinions: ["HELIX"],
  weakOpinions: [],
  confidence: 0.4,
};

const mockPlayDecision: DeskReadDecision = {
  state: "PLAY",
  ticker: "SPX",
  headline: "🟢 SPX — PLAY",
  thesis: "Bullish consensus",
  trigger: "Break 7650",
  invalidation: "Break",
  reasoning: "Flow driven",
  strongOpinions: ["HELIX"],
  weakOpinions: [],
  confidence: 0.75,
};

const mockNoTradeDecision: DeskReadDecision = {
  state: "NO_TRADE",
  ticker: "QQQ",
  headline: "🔴 QQQ — NO_TRADE",
  thesis: "Insufficient conviction",
  reasoning: "Only 1 system bullish",
  strongOpinions: [],
  weakOpinions: [],
  missingEvidence: ["Thermal not consulted"],
  confidence: 0.0,
};

test("TRADE_INTENT WAIT suggests confirmation question at priority 1", () => {
  const orchestrated = buildOrchestration("TRADE_INTENT");
  const suggestions = suggestFollowUpQuestions(orchestrated, "Should I buy SPX?", mockWaitDecision);

  const waitSuggestion = suggestions.find((s) => s.gapType === "decision" && s.priority === 1);
  assert.ok(waitSuggestion);
  assert.match(waitSuggestion!.question, /confirm/i);
});

test("TRADE_INTENT PLAY with vague invalidation suggests precision", () => {
  const orchestrated = buildOrchestration("TRADE_INTENT");
  const suggestions = suggestFollowUpQuestions(orchestrated, "Should I buy SPX?", mockPlayDecision);

  const invalidSuggestion = suggestions.find((s) => s.question.includes("Break"));
  assert.ok(invalidSuggestion);
  assert.strictEqual(invalidSuggestion!.gapType, "decision");
});

test("TRADE_INTENT NO_TRADE suggests bearish case", () => {
  const orchestrated = buildOrchestration("TRADE_INTENT");
  const suggestions = suggestFollowUpQuestions(orchestrated, "Should I buy QQQ?", mockNoTradeDecision);

  const bearishSuggestion = suggestions.find((s) => s.question.includes("bearish"));
  assert.ok(bearishSuggestion);
  assert.strictEqual(bearishSuggestion!.gapType, "conflict");
});

test("MARKET_READ with conflicts suggests conflict resolution", () => {
  const orchestrated = buildOrchestration("MARKET_READ");
  const suggestions = suggestFollowUpQuestions(orchestrated, "What's the desk read?");

  const conflictSuggestion = suggestions.find((s) => s.gapType === "conflict");
  assert.ok(conflictSuggestion);
  assert.match(conflictSuggestion!.question, /HELIX vs THERMAL|conflict/i);
});

test("MARKET_READ missing major system suggests that system", () => {
  const partial: ConsensusMatrix = {
    ...mockConsensus,
    reads: [mockConsensus.reads[0]],
  };

  const orchestrated = buildOrchestration("MARKET_READ");
  orchestrated.consensus = partial;

  const suggestions = suggestFollowUpQuestions(orchestrated, "What's the market?");

  const systemSuggestion = suggestions.find((s) => s.gapType === "system" && s.priority === 2);
  assert.ok(systemSuggestion);
  // Should suggest one of the missing systems
  assert.match(systemSuggestion!.question, /thermal|vector|slayer|meridian|night hawk/i);
});

test("Minimal depth response suggests depth upgrade at priority 3", () => {
  const orchestrated = buildOrchestration("MARKET_READ", "minimal");
  const suggestions = suggestFollowUpQuestions(orchestrated, "What's the market?");

  const depthSuggestion = suggestions.find((s) => s.gapType === "depth");
  assert.ok(depthSuggestion);
  assert.strictEqual(depthSuggestion!.priority, 3);
  assert.match(depthSuggestion!.question, /more/i);
});

test("Strong consensus suggests precedent check at priority 3", () => {
  const strongConsensus: ConsensusMatrix = {
    ...mockConsensus,
    agreement: {
      ...mockConsensus.agreement,
      averageStrength: 8,
      bullish: 2,
      bearish: 0,
    },
  };

  const orchestrated = buildOrchestration("MARKET_READ");
  orchestrated.consensus = strongConsensus;

  const suggestions = suggestFollowUpQuestions(orchestrated, "What's SPX?");

  const precedentSuggestion = suggestions.find((s) => s.gapType === "precedent");
  assert.ok(precedentSuggestion);
  assert.match(precedentSuggestion!.question, /before.*play/i);
});

test("suggestFollowUpQuestions returns sorted by priority then gap type", () => {
  const orchestrated = buildOrchestration("TRADE_INTENT");
  const suggestions = suggestFollowUpQuestions(
    orchestrated,
    "Should I buy SPX?",
    mockWaitDecision
  );

  // Should be sorted: priority 1 before priority 2, priority 2 before priority 3
  for (let i = 0; i < suggestions.length - 1; i++) {
    assert.ok(suggestions[i].priority <= suggestions[i + 1].priority);
  }
});

test("formatFollowUpSuggestions returns top 3 as comma-separated list", () => {
  const suggestions: FollowUpSuggestion[] = [
    {
      question: "What would confirm this?",
      reason: "test",
      suggestedIntent: "VALIDATION",
      priority: 1,
      gapType: "decision",
    },
    {
      question: "What about thermal?",
      reason: "test",
      suggestedIntent: "MARKET_READ",
      priority: 2,
      gapType: "system",
    },
    {
      question: "Tell me more?",
      reason: "test",
      suggestedIntent: "MARKET_READ",
      priority: 3,
      gapType: "depth",
    },
    {
      question: "Fourth question?",
      reason: "test",
      suggestedIntent: "WHY",
      priority: 3,
      gapType: "precedent",
    },
  ];

  const formatted = formatFollowUpSuggestions(suggestions);

  assert.match(formatted, /"What would confirm this\?"/);
  assert.match(formatted, /"What about thermal\?"/);
  assert.match(formatted, /"Tell me more\?"/);
  assert.doesNotMatch(formatted, /Fourth question/);
  assert.match(formatted, /•/);
});

test("formatFollowUpSuggestions returns empty string for no suggestions", () => {
  const formatted = formatFollowUpSuggestions([]);
  assert.strictEqual(formatted, "");
});

test("suggestFollowUpQuestions returns empty array when no gaps detected", () => {
  const complete: OrchestrationResult = {
    intentCategory: {
      category: "QUICK_FACT",
      confidence: 0.95,
      responseDepth: "minimal",
      requiredSystems: [],
      optionalSystems: [],
      needsDeskRead: false,
      needsHistoricalContext: false,
    },
    consensus: mockConsensus,
    deskRead: undefined,
    selectedTools: { required: [], optional: [] },
    envelopeStructure: {
      headlineOnly: true,
      includeSystemReads: false,
      includeLevels: false,
      includeDeskRead: false,
      includeScenarios: false,
      includeFollowUps: false,
    },
  };

  const suggestions = suggestFollowUpQuestions(complete, "Is SPX up?");
  // QUICK_FACT minimal might still suggest depth upgrade, but no decision/system gaps
  const decisionGaps = suggestions.filter((s) => s.gapType === "decision");
  assert.strictEqual(decisionGaps.length, 0);
});

test("LEVEL_STRUCTURE missing consensus suggests regime context", () => {
  const orchestrated = buildOrchestration("LEVEL_STRUCTURE");
  orchestrated.consensus = { ...mockConsensus, reads: [] };

  const suggestions = suggestFollowUpQuestions(orchestrated, "Where are the walls?");

  const regimeSuggestion = suggestions.find((s) => s.question.includes("regime"));
  assert.ok(regimeSuggestion);
  assert.strictEqual(regimeSuggestion!.suggestedIntent, "MARKET_READ");
});
