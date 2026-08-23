import test from "node:test";
import assert from "node:assert/strict";
import {
  getProseSectionsForIntent,
  formatProseDirectives,
  type ProseTemplate,
} from "./prose-template-builder";
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

const mockPlayDecision: DeskReadDecision = {
  state: "PLAY",
  ticker: "SPX",
  headline: "🟢 SPX — PLAY",
  thesis: "Bullish consensus with structural support",
  trigger: "Break 7650",
  invalidation: "Close below 7600",
  reasoning: "Flow driven",
  strongOpinions: ["HELIX"],
  weakOpinions: [],
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
  weakOpinions: [],
  confidence: 0.4,
};

const mockNoTradeDecision: DeskReadDecision = {
  state: "NO_TRADE",
  ticker: "QQQ",
  headline: "🔴 QQQ — NO_TRADE",
  thesis: "Insufficient conviction",
  reasoning: "Only 1 system bullish, gap vs structure",
  strongOpinions: [],
  weakOpinions: [],
  missingEvidence: ["Thermal not consulted"],
  confidence: 0.0,
};

test("QUICK_FACT returns minimal Verdict only", () => {
  const sections = getProseSectionsForIntent("QUICK_FACT", "minimal");

  assert.strictEqual(sections.length, 1);
  assert.strictEqual(sections[0].section, "Verdict");
  assert.match(sections[0].directive, /one sentence/i);
});

test("LEVEL_STRUCTURE returns Verdict + Facts scaled by depth", () => {
  const minimal = getProseSectionsForIntent("LEVEL_STRUCTURE", "minimal");
  const standard = getProseSectionsForIntent("LEVEL_STRUCTURE", "standard");

  assert.strictEqual(minimal.length, 1);
  assert.strictEqual(minimal[0].section, "Verdict");

  assert.strictEqual(standard.length, 2);
  assert.strictEqual(standard[0].section, "Verdict");
  assert.strictEqual(standard[1].section, "Facts");
  assert.match(standard[1].directive, /price structure/i);
});

test("FLOW forbids narrative gaps", () => {
  const sections = getProseSectionsForIntent("FLOW", "standard");

  assert.ok(sections.some((s) => s.section === "Facts"));
  const factSection = sections.find((s) => s.section === "Facts")!;
  assert.match(factSection.directive, /do NOT fill sparse flow with narrative/i);
  assert.match(factSection.directive, /flow light, tools to follow/i);
});

test("MARKET_READ requires honest conflict surfacing", () => {
  const sections = getProseSectionsForIntent("MARKET_READ", "standard");

  assert.ok(sections.some((s) => s.section === "Verdict"));
  assert.ok(sections.some((s) => s.section === "Facts"));
  assert.ok(sections.some((s) => s.section === "Interpretation"));

  const factSection = sections.find((s) => s.section === "Facts")!;
  assert.match(factSection.directive, /never reconcile disagreements/i);
  assert.match(factSection.directive, /surface them/i);
});

test("COMPARISON requires ranking across instruments", () => {
  const sections = getProseSectionsForIntent("COMPARISON", "standard");

  assert.ok(sections.some((s) => s.section === "Verdict"));
  assert.ok(sections.some((s) => s.section === "Facts"));

  const verdict = sections.find((s) => s.section === "Verdict")!;
  assert.match(verdict.directive, /which instrument is strongest/i);
});

test("TRADE_INTENT PLAY includes Trigger + Invalidation", () => {
  const sections = getProseSectionsForIntent("TRADE_INTENT", "standard", {
    deskRead: mockPlayDecision,
  });

  const sectionNames = sections.map((s) => s.section);
  assert.ok(sectionNames.includes("Verdict"));
  assert.ok(sectionNames.includes("Facts"));
  assert.ok(sectionNames.includes("Thesis"));
  assert.ok(sectionNames.includes("Trigger"));
  assert.ok(sectionNames.includes("Invalidation"));

  const trigger = sections.find((s) => s.section === "Trigger")!;
  assert.match(trigger.directive, /entry signal/i);
});

test("TRADE_INTENT WAIT emphasizes Gate resolution", () => {
  const sections = getProseSectionsForIntent("TRADE_INTENT", "standard", {
    deskRead: mockWaitDecision,
  });

  const sectionNames = sections.map((s) => s.section);
  assert.ok(sectionNames.includes("Gate"));
  assert.doesNotMatch(sectionNames.join(","), /Trigger/);

  const gate = sections.find((s) => s.section === "Gate")!;
  assert.match(gate.directive, /what must resolve/i);
});

test("TRADE_INTENT NO_TRADE explains missing evidence", () => {
  const sections = getProseSectionsForIntent("TRADE_INTENT", "standard", {
    deskRead: mockNoTradeDecision,
  });

  const sectionNames = sections.map((s) => s.section);
  assert.ok(sectionNames.includes("Missing"));

  const missing = sections.find((s) => s.section === "Missing")!;
  assert.match(missing.directive, /why conviction fails/i);
});

test("VALIDATION requires actual fills, forbids fiction", () => {
  const sections = getProseSectionsForIntent("VALIDATION", "standard");

  assert.ok(sections.some((s) => s.section === "Verdict"));
  const verdict = sections.find((s) => s.section === "Verdict")!;
  assert.match(verdict.directive, /filled price/i);

  const facts = sections.find((s) => s.section === "Facts")!;
  assert.match(facts.directive, /do NOT invent fills/i);
});

test("WHY requires root cause, not luck", () => {
  const sections = getProseSectionsForIntent("WHY", "standard");

  assert.ok(sections.some((s) => s.section === "Root Cause"));
  const rootCause = sections.find((s) => s.section === "Root Cause")!;
  assert.match(rootCause.directive, /lives in MARKET or EXECUTION/i);
  assert.match(rootCause.directive, /never in 'bad luck'/i);
});

test("depth scaling: minimal < standard < deep < institutional", () => {
  const standard = getProseSectionsForIntent("MARKET_READ", "standard");
  const deep = getProseSectionsForIntent("MARKET_READ", "deep");

  // Standard should have basic sections
  assert.strictEqual(standard.length, 4);

  // Deep should have same sections but with richer directives
  assert.strictEqual(deep.length, 4);

  // Spot check: Facts section expands
  const standardFacts = standard.find((s) => s.section === "Facts")!;
  const deepFacts = deep.find((s) => s.section === "Facts")!;

  assert.ok(standardFacts.depthScaling.standard);
  assert.ok(deepFacts.depthScaling.deep);
});

test("formatProseDirectives generates numbered list with depth hints", () => {
  const sections = getProseSectionsForIntent("TRADE_INTENT", "standard", {
    deskRead: mockPlayDecision,
  });

  const formatted = formatProseDirectives(sections, "standard");

  assert.match(formatted, /Prose Structure/);
  assert.match(formatted, /1\. \*\*Verdict\*\*/);
  assert.match(formatted, /→ standard:/);
});

test("formatProseDirectives returns empty string for no sections", () => {
  const formatted = formatProseDirectives([], "standard");
  assert.strictEqual(formatted, "");
});

test("Verdict scales with context: TRADE_INTENT uses deskRead state", () => {
  const playVert = getProseSectionsForIntent("TRADE_INTENT", "standard", {
    deskRead: mockPlayDecision,
  })[0];

  const waitVert = getProseSectionsForIntent("TRADE_INTENT", "standard", {
    deskRead: mockWaitDecision,
  })[0];

  const noVert = getProseSectionsForIntent("TRADE_INTENT", "standard", {
    deskRead: mockNoTradeDecision,
  })[0];

  assert.match(playVert.directive, /🟢 ENTER/);
  assert.match(waitVert.directive, /🟡 WAIT/);
  assert.match(noVert.directive, /🔴 STAND/);
});

test("MARKET_READ Verdict omits direction if conflicted", () => {
  const conflicted: ConsensusMatrix = {
    ...mockConsensus,
    agreement: {
      ...mockConsensus.agreement,
      bullish: 1,
      bearish: 1,
      direction: null,
      verdict: "conflicted",
    },
  };

  const sections = getProseSectionsForIntent("MARKET_READ", "standard", {
    consensus: conflicted,
  });

  const verdict = sections[0];
  assert.match(verdict.depthScaling.standard!, /Mixed signals/);
});

test("Risk section appears for TRADE_INTENT PLAY but not NO_TRADE at minimal depth", () => {
  const playMinimal = getProseSectionsForIntent("TRADE_INTENT", "minimal", {
    deskRead: mockPlayDecision,
  });

  const noTradeMinimal = getProseSectionsForIntent("TRADE_INTENT", "minimal", {
    deskRead: mockNoTradeDecision,
  });

  // At minimal, PLAY should omit Risk
  assert.strictEqual(
    playMinimal.some((s) => s.section === "Risk"),
    false
  );

  // NO_TRADE should omit Risk even at deep
  const noTradeDeep = getProseSectionsForIntent("TRADE_INTENT", "deep", {
    deskRead: mockNoTradeDecision,
  });
  assert.strictEqual(
    noTradeDeep.some((s) => s.section === "Risk"),
    false
  );
});
