import test from "node:test";
import assert from "node:assert/strict";
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import {
  diffBriefSnapshots,
  envelopeWithDiffSection,
  envelopeWithNarrativePulse,
  extrasFromBriefResponse,
  snapshotFromBrief,
} from "./play-brief-diff";

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
  assert.ok(lines.some((l) => l.includes("Thesis")));
  assert.ok(lines.some((l) => l.includes("P&L")));
});

test("diffBriefSnapshots: omits thesis health delta when uncalibrated (extends #4318)", () => {
  const uncalibrated = {
    health: 46,
    rungLabel: "Degraded",
    pillars: [
      {
        id: "structure",
        label: "Persistence",
        weight: 0.28,
        commitScore: 0.4,
        currentScore: 0.35,
        commitLabel: "unknown",
        currentLabel: "unknown",
        status: "intact",
        contributionPts: 10,
        deltaPts: -1,
      },
      {
        id: "momentum",
        label: "Entry geometry",
        weight: 0.22,
        commitScore: 0.5,
        currentScore: 0.45,
        commitLabel: "n/a",
        currentLabel: "n/a",
        status: "intact",
        contributionPts: 10,
        deltaPts: -1,
      },
      {
        id: "flow",
        label: "Signal stack",
        weight: 0.2,
        commitScore: 0.35,
        currentScore: 0.35,
        commitLabel: "no signals",
        currentLabel: "no signals",
        status: "intact",
        contributionPts: 7,
        deltaPts: 0,
      },
    ],
    moves: [],
    advisory: "",
    entryIndex: 60,
    currentIndex: 46,
    delta: -14,
    rung: "DEGRADED",
    committedAtEt: "",
    computedAtEt: "",
  };
  const prev = snapshotFromBrief(env(), play({ thesisHealth: uncalibrated, pnlPct: 20 }));
  const next = snapshotFromBrief(
    env(),
    play({ thesisHealth: { ...uncalibrated, health: 52, currentIndex: 52, delta: -8 }, pnlPct: 25 }),
  );
  const lines = diffBriefSnapshots(prev, next);
  assert.ok(!lines.some((l) => l.includes("Thesis")), "uncalibrated rows must not narrate thesis % shifts");
  assert.ok(lines.some((l) => l.includes("P&L")), "P&L diff still fires on uncalibrated rows");
});

test("envelopeWithDiffSection: prepends change section", () => {
  const out = envelopeWithDiffSection(env(), ["Spot moved"]);
  assert.equal(out.sections[0]?.title, "What changed");
  assert.match(out.sections[0]?.body ?? "", /Spot moved/);
});

test("extrasFromBriefResponse: reads levels by label AND the explicit flowSnapshot field", () => {
  const response = {
    envelope: {
      ...env(),
      levels: [
        { label: "spot", price: 100.5, provenance: { source: "Vector", freshness: "live" as const } },
        { label: "call wall", price: 105, provenance: { source: "GEX", freshness: "recent" as const } },
        { label: "put wall", price: 95, provenance: { source: "GEX", freshness: "recent" as const } },
        { label: "gamma flip", price: 98, provenance: { source: "GEX", freshness: "recent" as const } },
      ],
    },
    flowSnapshot: { callPremium: 1_500_000, putPremium: 300_000 },
  };
  assert.deepEqual(extrasFromBriefResponse(response), {
    spot: 100.5,
    gammaFlip: 98,
    callWall: 105,
    putWall: 95,
    flowCallPremium: 1_500_000,
    flowPutPremium: 300_000,
    trimsFired: null,
  });
});

test("extrasFromBriefResponse: no flowSnapshot on the response is null, not a crash", () => {
  assert.deepEqual(extrasFromBriefResponse({ envelope: env() }), {
    spot: null,
    gammaFlip: null,
    callWall: null,
    putWall: null,
    flowCallPremium: null,
    flowPutPremium: null,
    trimsFired: null,
  });
});

test("diffBriefSnapshots: detects trim rail fires", () => {
  const prev = snapshotFromBrief(env(), play(), { trimsFired: 0 });
  const next = snapshotFromBrief(env(), play(), { trimsFired: 1 });
  const lines = diffBriefSnapshots(prev, next);
  assert.ok(lines.some((l) => l.includes("Trim rail")));
});

test("envelopeWithNarrativePulse: weaves pulse into Trade manager read", () => {
  const base = {
    ...env(),
    sections: [
      { title: "Trade manager read", body: "• Hold the line", bias: "neutral" as const },
      { title: "Verdict", body: "ok", bias: "neutral" as const },
    ],
  };
  const out = envelopeWithNarrativePulse(base, ["P&L +5% → +8%", "Spot moved"]);
  const narrative = out.sections.find((s) => s.title === "Trade manager read");
  assert.match(narrative!.body, /Since last read/i);
  assert.match(narrative!.body, /Hold the line/);
  assert.ok(!out.sections.some((s) => s.title === "What changed"));
});

test("envelopeWithNarrativePulse: overflow changes get What changed section", () => {
  const base = {
    ...env(),
    sections: [{ title: "Trade manager read", body: "• Hold", bias: "neutral" as const }],
  };
  const out = envelopeWithNarrativePulse(base, ["a", "b", "c", "d"]);
  assert.ok(out.sections.some((s) => s.title === "What changed"));
});

test("diffBriefSnapshots: detects HELIX call flow shift", () => {
  const baseEnvelope = env();
  const prevResponse = { envelope: baseEnvelope, flowSnapshot: { callPremium: 500_000, putPremium: 400_000 } };
  const nextResponse = { envelope: baseEnvelope, flowSnapshot: { callPremium: 900_000, putPremium: 380_000 } };
  const prevSnap = snapshotFromBrief(baseEnvelope, play(), extrasFromBriefResponse(prevResponse));
  const nextSnap = snapshotFromBrief(baseEnvelope, play(), extrasFromBriefResponse(nextResponse));
  const lines = diffBriefSnapshots(prevSnap, nextSnap);
  assert.ok(
    lines.some((l) => l.includes("HELIX tape: call flow building")),
    `expected call flow building line, got: ${JSON.stringify(lines)}`,
  );
});

test("diffBriefSnapshots: detects HELIX put-only flow build when call premium is flat", () => {
  const baseEnvelope = env();
  const prevResponse = { envelope: baseEnvelope, flowSnapshot: { callPremium: 500_000, putPremium: 400_000 } };
  const nextResponse = { envelope: baseEnvelope, flowSnapshot: { callPremium: 510_000, putPremium: 1_500_000 } };
  const prevSnap = snapshotFromBrief(baseEnvelope, play(), extrasFromBriefResponse(prevResponse));
  const nextSnap = snapshotFromBrief(baseEnvelope, play(), extrasFromBriefResponse(nextResponse));
  const lines = diffBriefSnapshots(prevSnap, nextSnap);
  assert.ok(
    lines.some((l) => l.includes("HELIX tape: put flow building")),
    `expected put flow building line, got: ${JSON.stringify(lines)}`,
  );
});
