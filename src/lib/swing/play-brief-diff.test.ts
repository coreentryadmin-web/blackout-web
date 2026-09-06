import test from "node:test";
import assert from "node:assert/strict";
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import { diffBriefSnapshots, envelopeWithDiffSection, snapshotFromBrief } from "./play-brief-diff";

function env(headline = "HOLD — TEST"): BieAnswerEnvelope {
  return {
    version: 1,
    asOf: new Date().toISOString(),
    headline,
    bias: "bullish",
    sections: [{ title: "Verdict", body: "ok" }],
    evidence: [],
    markdown: "",
  };
}

function play(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "SWING:TEST",
    ticker: "TEST",
    direction: "LONG",
    contract: "100C · 13DTE",
    score: 70,
    status: "HOLD",
    horizon: "SWING",
    exitModel: "SCALE_OUT",
    recommendation: "HOLD",
    factors: [],
    gates: [],
    ...overrides,
  };
}

test("diffBriefSnapshots: first snapshot yields no changes", () => {
  const snap = snapshotFromBrief(env(), play());
  assert.deepEqual(diffBriefSnapshots(null, snap), []);
});

test("diffBriefSnapshots: detects thesis health and P&L moves", () => {
  const prev = snapshotFromBrief(env(), play({ thesisHealth: { health: 60, rungLabel: "ok", pillars: [], moves: [], advisory: "", entryIndex: 60, currentIndex: 60, delta: 0, rung: "OK", committedAtEt: "", computedAtEt: "" }, pnlPct: 20 }));
  const next = snapshotFromBrief(env(), play({ thesisHealth: { health: 54, rungLabel: "fade", pillars: [], moves: [], advisory: "", entryIndex: 60, currentIndex: 54, delta: -6, rung: "DEGRADED", committedAtEt: "", computedAtEt: "" }, pnlPct: 25 }));
  const lines = diffBriefSnapshots(prev, next);
  assert.ok(lines.some((l) => l.includes("Thesis health")));
  assert.ok(lines.some((l) => l.includes("P&L")));
});

test("envelopeWithDiffSection: prepends change section", () => {
  const out = envelopeWithDiffSection(env(), ["Spot moved"]);
  assert.equal(out.sections[0]?.title, "What changed");
  assert.match(out.sections[0]?.body ?? "", /Spot moved/);
});
