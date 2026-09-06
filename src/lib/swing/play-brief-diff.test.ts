import test from "node:test";
import assert from "node:assert/strict";
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import {
  diffBriefSnapshots,
  envelopeWithDiffSection,
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

test("end-to-end: a HELIX call-flow build now actually reaches the diff engine (was previously always null)", () => {
  const baseEnvelope = env();
  const prevResponse = { envelope: baseEnvelope, flowSnapshot: { callPremium: 500_000, putPremium: 400_000 } };
  const nextResponse = { envelope: baseEnvelope, flowSnapshot: { callPremium: 900_000, putPremium: 380_000 } };
  const prevSnap = snapshotFromBrief(baseEnvelope, play(), extrasFromBriefResponse(prevResponse));
  const nextSnap = snapshotFromBrief(baseEnvelope, play(), extrasFromBriefResponse(nextResponse));
  const lines = diffBriefSnapshots(prevSnap, nextSnap);
  assert.ok(
    lines.some((l) => l.includes("HELIX tape")),
    `expected a HELIX tape flow-shift line, got: ${JSON.stringify(lines)}`,
  );
});
