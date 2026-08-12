import test from "node:test";
import assert from "node:assert/strict";
import { deskReadVisibility, hasComparisonBlock } from "./desk-read-layout";
import { makeEnvelope } from "@/lib/bie/answer-envelope";

test("hasComparisonBlock detects model comparison fences", () => {
  assert.equal(hasComparisonBlock('{"type":"comparison"}'), true);
  assert.equal(hasComparisonBlock("plain prose"), false);
});

test("comparison blocks suppress duplicate signal layers", () => {
  const envelope = makeEnvelope({
    headline: "NVDA leans bullish on flow",
    sections: [],
    evidence: [],
    systemReads: {
      reads: [{ system: "FLOW", basis: "call-heavy", stance: "bullish" }],
    },
    levels: [{ label: "Call wall", price: 140, kind: "resistance" }],
    tradeDecision: {
      ticker: "NVDA",
      actionLabel: "WAIT",
      signalRows: [{ signal: "Flow", read: "bullish", bias: "bullish", glyph: "↑" }],
    },
  });
  const vis = deskReadVisibility(
    envelope,
    '```blackout\n{"type":"comparison"}\n```'
  );
  assert.equal(vis.showSystemReads, false);
  assert.equal(vis.showFallbackSignals, false);
  assert.equal(vis.showLevelSignals, false);
  assert.equal(vis.showInlineBlocks, true);
});

test("fallback signals show when no comparison block", () => {
  const envelope = makeEnvelope({
    headline: "Wait for reclaim",
    sections: [],
    evidence: [],
    tradeDecision: {
      ticker: "NVDA",
      actionLabel: "WAIT",
      signalRows: [{ signal: "Structure", read: "below EMA", bias: "bearish", glyph: "↓" }],
    },
  });
  const vis = deskReadVisibility(envelope, "plain answer");
  assert.equal(vis.showFallbackSignals, true);
  assert.equal(vis.showInlineBlocks, false);
});

test("no-read verdict hides the direction chip", () => {
  const envelope = makeEnvelope({ headline: "No read — data stale", sections: [], evidence: [] });
  const vis = deskReadVisibility(envelope, "");
  assert.equal(vis.state, "no-read");
  assert.equal(vis.showStateChip, false);
});

test("duplicate confidence prose is not rendered twice", () => {
  const envelope = makeEnvelope({
    headline: "Mixed",
    sections: [{ title: "Confidence", body: "IV rank is median." }],
    evidence: [],
    confidence: { level: "low", why: "IV rank is median." },
  });
  const vis = deskReadVisibility(envelope, "");
  assert.equal(vis.showConfidenceWhy, false);
});
