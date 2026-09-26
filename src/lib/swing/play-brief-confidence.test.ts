import test from "node:test";
import assert from "node:assert/strict";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import type { BieUnavailableSource } from "@/lib/bie/answer-envelope";
import { swingPlayBriefConfidence } from "./play-brief-confidence";

function fixturePlay(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "SWING:INTC",
    ticker: "INTC",
    direction: "LONG",
    contract: "90C · 13DTE",
    score: 72,
    tierLabel: "B",
    status: "WATCH",
    horizon: "SWING",
    exitModel: "SCALE_OUT",
    recommendation: "BUY",
    factors: [],
    gates: [],
    regime: "Sector rotation · regime 0.82",
    archetype: "BREAKOUT",
    servingSection: "WAITING_FOR_ENTRY",
    setupState: "FORMING",
    entryStatus: "PRE_TRIGGER",
    thesisBreak: { level: "intact", note: "Structure holding" },
    ...overrides,
  };
}

const oneUnavailable: BieUnavailableSource[] = [
  { source: "HELIX flow", reason: "pipeline stale", what_is_missing: "a fresh tick", retryable: true },
];
const twoUnavailable: BieUnavailableSource[] = [
  ...oneUnavailable,
  { source: "GEX matrix", reason: "stale", what_is_missing: "a fresh rebuild", retryable: true },
];

test("swingPlayBriefConfidence: CLOSED play is always high — the outcome is the ledger record", () => {
  const play = fixturePlay({ status: "CLOSED", entryPresentPillars: 1 }); // even thin entry evidence
  const c = swingPlayBriefConfidence(play, "closed", twoUnavailable); // even with sources missing
  assert.equal(c.level, "high");
  assert.match(c.why, /ledger record/);
});

test("swingPlayBriefConfidence: thin entry evidence (entryPresentPillars non-null) is low, regardless of live source coverage", () => {
  const play = fixturePlay({ status: "OPEN", entryPresentPillars: 2 });
  const cNoGaps = swingPlayBriefConfidence(play, "open", []);
  assert.equal(cNoGaps.level, "low");
  assert.match(cNoGaps.why, /2\/7 pillars grounded/);

  const cWithGaps = swingPlayBriefConfidence(play, "open", twoUnavailable);
  assert.equal(cWithGaps.level, "low", "thin-entry gate dominates over live-source coverage");
});

test("swingPlayBriefConfidence: full entry evidence (entryPresentPillars null) + zero unavailable sources is high", () => {
  const play = fixturePlay({ status: "OPEN", entryPresentPillars: null });
  const c = swingPlayBriefConfidence(play, "open", []);
  assert.equal(c.level, "high");
  assert.match(c.why, /resolved cleanly/);
});

test("swingPlayBriefConfidence: full entry evidence + some unavailable sources is moderate, and cites the real count", () => {
  const play = fixturePlay({ status: "OPEN", entryPresentPillars: undefined });
  const c1 = swingPlayBriefConfidence(play, "open", oneUnavailable);
  assert.equal(c1.level, "moderate");
  assert.match(c1.why, /^1 source /);

  const c2 = swingPlayBriefConfidence(play, "open", twoUnavailable);
  assert.equal(c2.level, "moderate");
  assert.match(c2.why, /^2 sources /);
});

test("swingPlayBriefConfidence: WATCH bucket (never committed, entryPresentPillars null) follows the same live-coverage rule as OPEN", () => {
  const play = fixturePlay({ status: "WATCH", entryPresentPillars: null });
  assert.equal(swingPlayBriefConfidence(play, "watch", []).level, "high");
  assert.equal(swingPlayBriefConfidence(play, "watch", oneUnavailable).level, "moderate");
});

test("swingPlayBriefConfidence: every level/why pair is one of the four documented BieConfidenceLevel values", () => {
  const play = fixturePlay({ status: "OPEN" });
  const levels = new Set([
    swingPlayBriefConfidence(play, "closed", []).level,
    swingPlayBriefConfidence({ ...play, entryPresentPillars: 3 }, "open", []).level,
    swingPlayBriefConfidence({ ...play, entryPresentPillars: null }, "open", []).level,
    swingPlayBriefConfidence({ ...play, entryPresentPillars: null }, "open", oneUnavailable).level,
  ]);
  for (const level of levels) {
    assert.ok(["high", "moderate", "low", "insufficient"].includes(level));
  }
});

test("swingPlayBriefConfidence: never mutates the play object (pure, read-only input)", () => {
  const play = fixturePlay({ status: "OPEN", entryPresentPillars: 2 });
  const before = JSON.stringify(play);
  swingPlayBriefConfidence(play, "open", twoUnavailable);
  assert.equal(JSON.stringify(play), before);
});

test("swingPlayBriefConfidence: never reads direction/score/exit fields — verified by fixtures that vary them with no effect on the verdict", () => {
  const base = fixturePlay({ status: "OPEN", entryPresentPillars: null, direction: "LONG", score: 10 });
  const varied = fixturePlay({ status: "OPEN", entryPresentPillars: null, direction: "SHORT", score: 99 });
  assert.deepEqual(
    swingPlayBriefConfidence(base, "open", oneUnavailable),
    swingPlayBriefConfidence(varied, "open", oneUnavailable),
    "direction/score must not influence confidence — it is an evidence-coverage read, not a directional one"
  );
});
