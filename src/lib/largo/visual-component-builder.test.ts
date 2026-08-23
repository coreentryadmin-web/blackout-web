import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConsensusComponent,
  buildLevelsComponent,
  buildTradeDecisionComponent,
  buildEvidenceComponent,
  buildRiskComponent,
  buildDecisionCallout,
  buildConsensusHeader,
  type BlackoutComponent,
} from "./visual-component-builder";
import type { ConsensusMatrix } from "./consensus-read-extract";
import type { DeskReadDecision } from "./desk-read-decision";

// Test fixtures
const mockConsensus: ConsensusMatrix = {
  reads: [
    {
      system: "HELIX",
      direction: "bullish",
      strength: 8,
      basis: "net calls 70%",
      evidence: ["call flow stacking"],
      asOf: new Date(),
      freshness: "live",
      internalConflict: false,
    },
    {
      system: "THERMAL",
      direction: "bearish",
      strength: 7,
      basis: "negative gamma at spot",
      evidence: ["gamma flip below"],
      asOf: new Date(),
      freshness: "live",
      internalConflict: false,
    },
    {
      system: "VECTOR",
      direction: "neutral",
      strength: 4,
      basis: "mixed structure HH/LL",
      evidence: ["no clear direction"],
      asOf: new Date(),
      freshness: "live",
      internalConflict: false,
    },
  ],
  agreement: {
    voting: 3,
    bullish: 1,
    bearish: 1,
    neutral: 1,
    verdict: "conflicted",
    direction: null,
    averageStrength: 6.3,
  },
  contradictions: [
    {
      pair: "HELIX vs THERMAL",
      stronger: "THERMAL",
      why: "tape bullish but gamma not supporting",
    },
  ],
};

const mockPlayDecision: DeskReadDecision = {
  state: "PLAY",
  ticker: "SPX",
  headline: "🟢 SPX — PLAY",
  thesis: "3-system bullish consensus with structural support",
  trigger: "Break and hold above 7650",
  invalidation: "Close below 7600",
  reasoning: "HELIX + VECTOR in agreement, regime aligned",
  strongOpinions: ["HELIX", "VECTOR"],
  weakOpinions: ["THERMAL"],
  confidence: 0.75,
};

const mockWaitDecision: DeskReadDecision = {
  state: "WAIT",
  ticker: "SPX",
  headline: "🟡 SPX — WAIT",
  thesis: "Mixed signals until gate resolves",
  trigger: "Close above 7650 confirms",
  invalidation: "Close below 7600 stops",
  reasoning: "Tape bullish but structure unclear",
  strongOpinions: ["HELIX"],
  weakOpinions: ["VECTOR", "THERMAL"],
  missingEvidence: ["0DTE board not consulted"],
  confidence: 0.4,
};

const mockNoTradeDecision: DeskReadDecision = {
  state: "NO_TRADE",
  ticker: "QQQ",
  headline: "🔴 QQQ — NO_TRADE",
  thesis: "Insufficient conviction",
  reasoning: "Only 1 system bullish, gap vs structure",
  strongOpinions: [],
  weakOpinions: ["HELIX", "VECTOR"],
  missingEvidence: ["Thermal not consulted", "Flow sparse"],
  confidence: 0.0,
};

test("buildConsensusComponent generates comparison from consensus reads", () => {
  const component = buildConsensusComponent(mockConsensus);

  assert.strictEqual(component.type, "comparison");
  assert.match(component.title!, /consensus/i);
  assert.strictEqual(component.rows!.length, 3);

  const helixRow = component.rows![0];
  assert.strictEqual(helixRow.label, "helix");
  assert.match(helixRow.reading, /bullish|↑/i);
  assert.strictEqual(helixRow.tone, "bullish");

  const thermalRow = component.rows![1];
  assert.strictEqual(helixRow.tone, "bullish");
  assert.strictEqual(thermalRow.tone, "bearish");
});

test("buildConsensusComponent includes conflict note when systems disagree", () => {
  const component = buildConsensusComponent(mockConsensus);

  assert.strictEqual(component.subtitle, "1 conflict: tape bullish but gamma not supporting");
});

test("buildLevelsComponent creates levels with support/resistance", () => {
  const levels = { floor: 7600, gate: 7650, king: 7750 };
  const component = buildLevelsComponent(levels, 7640);

  assert.strictEqual(component.type, "levels");
  assert.strictEqual(component.spot, 7640);
  assert.strictEqual(component.items!.length, 3);

  const floor = component.items![0];
  assert.strictEqual(floor.label, "Floor (support)");
  assert.strictEqual(floor.price, 7600);
  assert.strictEqual(floor.kind, "support");

  const gate = component.items![1];
  assert.strictEqual(gate.kind, "pivot");

  const king = component.items![2];
  assert.strictEqual(king.kind, "resistance");
});

test("buildLevelsComponent omits missing levels", () => {
  const levels = { floor: 7600, gate: 7650, king: 0 };
  const component = buildLevelsComponent(levels);

  assert.strictEqual(component.items!.length, 2);
  const hasKing = component.items!.some((item) => item.label.includes("King"));
  assert.strictEqual(hasKing, false);
});

test("buildTradeDecisionComponent PLAY includes trigger and invalidation", () => {
  const component = buildTradeDecisionComponent(mockPlayDecision);

  assert.strictEqual(component.type, "comparison");
  assert.match(component.title!, /🟢/);
  assert.match(component.title!, /PLAY/);

  const rows = component.rows!;
  assert.ok(rows.some((r) => r.label === "Trigger"));
  assert.ok(rows.some((r) => r.label === "Invalidation"));
});

test("buildTradeDecisionComponent WAIT emphasizes condition-to-confirm", () => {
  const component = buildTradeDecisionComponent(mockWaitDecision);

  assert.match(component.title!, /🟡/);
  assert.match(component.title!, /WAIT/);

  const triggerRow = component.rows!.find((r) => r.label === "Trigger");
  assert.ok(triggerRow?.note?.includes("condition to confirm"));
});

test("buildTradeDecisionComponent NO_TRADE omits missing trigger", () => {
  const component = buildTradeDecisionComponent(mockNoTradeDecision);

  assert.match(component.title!, /🔴/);
  const triggerRow = component.rows!.find((r) => r.label === "Trigger");
  assert.strictEqual(triggerRow, undefined);
});

test("buildEvidenceComponent shows bullish vs bearish side-by-side", () => {
  const component = buildEvidenceComponent(mockConsensus);

  assert.strictEqual(component!.type, "evidence");
  assert.strictEqual(component!.bull!.length, 1); // HELIX bullish
  assert.strictEqual(component!.bear!.length, 1); // THERMAL bearish
  assert.ok(component!.neutral); // VECTOR neutral
});

test("buildEvidenceComponent returns null if no bullish or bearish signals", () => {
  const allNeutral: ConsensusMatrix = {
    ...mockConsensus,
    reads: [
      {
        system: "VECTOR",
        direction: "neutral",
        strength: 5,
        basis: "flat",
        evidence: [],
        asOf: new Date(),
        freshness: "live",
        internalConflict: false,
      },
    ],
  };

  const component = buildEvidenceComponent(allNeutral);
  assert.strictEqual(component, null);
});

test("buildRiskComponent PLAY includes invalidation", () => {
  const component = buildRiskComponent(mockPlayDecision);

  assert.strictEqual(component.type, "risk");
  assert.match(component.title!, /breaks this play/i);
  assert.strictEqual(component.invalidation, "Close below 7600");
});

test("buildRiskComponent includes missing evidence when present", () => {
  const component = buildRiskComponent(mockWaitDecision);

  const hasEvidence = component.items!.some((item) => item.label === "Missing evidence");
  assert.strictEqual(hasEvidence, true);
});

test("buildDecisionCallout generates one-liner with glyph", () => {
  const callout = buildDecisionCallout(mockPlayDecision);

  assert.strictEqual(callout.type, "callout");
  assert.match(callout.title!, /🟢 ENTER/);
  assert.match(callout.body, /3-system bullish/);
  assert.match(callout.body, /75%/); // confidence
});

test("buildDecisionCallout WAIT shows WAIT_FOR_TRIGGER", () => {
  const callout = buildDecisionCallout(mockWaitDecision);

  assert.match(callout.title!, /🟡 WAIT FOR TRIGGER/);
});

test("buildDecisionCallout NO_TRADE shows STAND_ASIDE", () => {
  const callout = buildDecisionCallout(mockNoTradeDecision);

  assert.match(callout.title!, /🔴 STAND ASIDE/);
  assert.strictEqual(callout.tone, "bearish");
});

test("buildConsensusHeader shows voting summary in subtitle", () => {
  const header = buildConsensusHeader(mockConsensus, "Market Read");

  assert.strictEqual(header.type, "header");
  assert.strictEqual(header.title, "Market Read");
  assert.match(header.subtitle!, /3 systems consulted/);
  assert.strictEqual(header.badge, "conflicted");
});

test("buildConsensusHeader tone reflects consensus direction", () => {
  const bullish: ConsensusMatrix = {
    ...mockConsensus,
    agreement: {
      ...mockConsensus.agreement,
      bullish: 3,
      bearish: 0,
      direction: "bullish",
      verdict: "bullish",
    },
  };

  const header = buildConsensusHeader(bullish, "Bullish");
  assert.strictEqual(header.tone, "bullish");

  const conflicted = buildConsensusHeader(mockConsensus, "Conflicted");
  assert.strictEqual(conflicted.tone, "warning");
});

test("buildConsensusHeader confidence level based on average strength", () => {
  const strong: ConsensusMatrix = {
    ...mockConsensus,
    agreement: {
      ...mockConsensus.agreement,
      averageStrength: 9,
    },
  };

  const header = buildConsensusHeader(strong, "Strong");
  assert.strictEqual(header.confidence!.level, "high");

  const weak: ConsensusMatrix = {
    ...mockConsensus,
    agreement: {
      ...mockConsensus.agreement,
      averageStrength: 3,
    },
  };

  const weakHeader = buildConsensusHeader(weak, "Weak");
  assert.strictEqual(weakHeader.confidence!.level, "low");
});
