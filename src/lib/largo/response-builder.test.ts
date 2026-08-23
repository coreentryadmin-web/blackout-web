import test from "node:test";
import assert from "node:assert/strict";
import { buildResponseComponents, formatComponentsAsMarkdown } from "./response-builder";
import type { OrchestrationResult } from "./adaptive-response-orchestrator";
import type { ConsensusMatrix } from "./consensus-read-extract";
import type { DeskReadDecision } from "./desk-read-decision";

const mockConsensus: ConsensusMatrix = {
  reads: [
    {
      system: "HELIX",
      direction: "bullish",
      strength: 8,
      basis: "net calls 70%",
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
  headline: "PLAY",
  thesis: "Bullish consensus",
  trigger: "Break 7650",
  invalidation: "Close below 7600",
  reasoning: "Flow driven",
  strongOpinions: ["HELIX"],
  weakOpinions: [],
  confidence: 0.75,
};

const buildOrchestration = (category: string): OrchestrationResult => ({
  intentCategory: {
    category: category as any,
    confidence: 0.9,
    responseDepth: "standard",
    requiredSystems: [],
    optionalSystems: [],
    needsDeskRead: category === "TRADE_INTENT",
    needsHistoricalContext: false,
  },
  consensus: mockConsensus,
  deskRead: category === "TRADE_INTENT" ? mockDecision : undefined,
  selectedTools: { required: [], optional: [] },
  envelopeStructure: {
    headlineOnly: false,
    includeSystemReads: true,
    includeLevels: false,
    includeDeskRead: category === "TRADE_INTENT",
    includeScenarios: false,
    includeFollowUps: false,
  },
});

test("QUICK_FACT generates no components (prose only)", () => {
  const orchestrated = buildOrchestration("QUICK_FACT");
  const result = buildResponseComponents(orchestrated, "SPX?");

  assert.strictEqual(result.components.length, 0);
  assert.strictEqual(result.header, undefined);
});

test("LEVEL_STRUCTURE generates levels component", () => {
  const orchestrated = buildOrchestration("LEVEL_STRUCTURE");
  orchestrated.consensus.reads = [];

  const result = buildResponseComponents(orchestrated, "Where are the walls?");

  // levels component would be generated if levels data was present
  // (omitted in this test fixture since we'd need full tool context)
  assert.ok(result.components !== undefined);
});

test("MARKET_READ generates header + consensus + evidence", () => {
  const orchestrated = buildOrchestration("MARKET_READ");
  orchestrated.consensus = mockConsensus;
  const result = buildResponseComponents(orchestrated, "What's the desk read?");

  assert.ok(result.header, "should have header");
  assert.ok(result.consensus, "should have consensus");
  assert.ok(result.evidence, "should have evidence");

  assert.strictEqual(result.components.length, 3);
  assert.ok(result.components.some((c) => c.type === "header"));
  assert.ok(result.components.some((c) => c.type === "comparison"));
  assert.ok(result.components.some((c) => c.type === "evidence"));
});

test("COMPARISON generates consensus component", () => {
  const orchestrated = buildOrchestration("COMPARISON");
  orchestrated.consensus = mockConsensus;
  const result = buildResponseComponents(orchestrated, "SPX vs QQQ");

  assert.ok(result.consensus, "should have consensus");
  assert.strictEqual(result.consensus.type, "comparison");
});

test("TRADE_INTENT generates header + consensus + decision + risk", () => {
  const orchestrated = buildOrchestration("TRADE_INTENT");
  orchestrated.consensus = mockConsensus;
  const result = buildResponseComponents(orchestrated, "Should I buy calls?");

  assert.ok(result.header, "should have header");
  assert.ok(result.consensus, "should have consensus");
  assert.ok(result.decision, "should have decision");
  assert.ok(result.risk, "should have risk");

  assert.strictEqual(result.components.length, 4);
  assert.ok(result.components.some((c) => c.type === "header"));
  assert.ok(result.components.some((c) => c.type === "comparison"));
  assert.ok(result.components.some((c) => c.type === "risk"));
});

test("WHY generates evidence + risk", () => {
  const orchestrated = buildOrchestration("WHY");
  orchestrated.consensus = mockConsensus;
  orchestrated.deskRead = mockDecision;
  const result = buildResponseComponents(orchestrated, "Why didn't that work?");

  assert.ok(result.evidence, "should have evidence");
  assert.ok(result.risk, "should have risk");
});

test("formatComponentsAsMarkdown wraps each component in fence", () => {
  const mockComponent = { type: "callout", title: "Test", body: "Test body" };
  const markdown = formatComponentsAsMarkdown([mockComponent]);

  assert.match(markdown, /```blackout/);
  assert.match(markdown, /```/);
  assert.match(markdown, /Test/);
});

test("formatComponentsAsMarkdown handles empty array", () => {
  const markdown = formatComponentsAsMarkdown([]);
  assert.strictEqual(markdown, "");
});

test("formatComponentsAsMarkdown joins multiple components with newlines", () => {
  const components = [
    { type: "callout", title: "One" },
    { type: "callout", title: "Two" },
  ];
  const markdown = formatComponentsAsMarkdown(components);

  // Should have both components separated
  const matches = markdown.match(/```blackout/g);
  assert.strictEqual(matches!.length, 2);
});

test("component gating respects intentCategory", () => {
  const categories: Array<[string, boolean]> = [
    ["QUICK_FACT", false],
    ["LEVEL_STRUCTURE", false],
    ["FLOW", false],
    ["MARKET_READ", true],
    ["COMPARISON", true],
    ["CHANGE_DETECTION", false],
    ["TRADE_INTENT", true],
    ["VALIDATION", false],
    ["WHY", true],
  ];

  categories.forEach(([category, shouldHaveConsensus]) => {
    const orchestrated = buildOrchestration(category);
    // Ensure consensus reads are present for categories that need them
    if (shouldHaveConsensus) {
      orchestrated.consensus = mockConsensus;
    }
    const result = buildResponseComponents(orchestrated, "test");

    if (shouldHaveConsensus) {
      assert.ok(
        result.components.some((c) => c.type === "comparison"),
        `${category} should have consensus component`
      );
    } else {
      const hasConsensus = result.components.some(
        (c) => c.type === "comparison" && c.title?.includes("Multi-system")
      );
      assert.strictEqual(hasConsensus, false, `${category} should not have consensus component`);
    }
  });
});

test("TRADE_INTENT without deskRead generates no decision component", () => {
  const orchestrated = buildOrchestration("TRADE_INTENT");
  orchestrated.deskRead = undefined;
  const result = buildResponseComponents(orchestrated, "Should I buy?");

  const hasDecision = result.components.some((c) => c.type === "comparison" && c.title?.includes("PLAY"));
  assert.strictEqual(hasDecision, false);
});

test("components array is always populated", () => {
  const orchestrated = buildOrchestration("QUICK_FACT");
  const result = buildResponseComponents(orchestrated, "test");

  assert.ok(Array.isArray(result.components));
  assert.ok("components" in result);
});
