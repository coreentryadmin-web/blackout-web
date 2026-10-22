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

test("swingPlayBriefConfidence: moderate 'why' names the actual unavailable sources, not a pointer to a section that may not exist or contain them (live repro 2026-09-28)", () => {
  // BUG: previously said "see Data freshness" — but dataFreshnessSection only covers option-mark/
  // scan/Vector-age/GEX-age/HELIX-pipeline staleness, a disjoint check set from these
  // unavailableSources entries (ecosystem-context/Vector-state fetch failures etc.), and can
  // return null (section absent entirely) even while unavailableSources is non-empty.
  const play = fixturePlay({ status: "WATCH", entryPresentPillars: null });
  const c = swingPlayBriefConfidence(play, "watch", twoUnavailable);
  assert.equal(c.level, "moderate");
  assert.ok(!/Data freshness/i.test(c.why), `must not point at a section that may not have this info or exist: ${c.why}`);
  assert.match(c.why, /HELIX flow/);
  assert.match(c.why, /GEX matrix/);
});

// BUG FIX (2026-10-21, Ask Largo 5-engine cycle, live repro MRNA/RNG/DKNG/TSLA/SHOP): any count
// >=1 used to read "moderate" with no further graduation — live data showed 6, 7, and 8
// unavailable sources all rendering identically to the 1-2 cases pinned above. Grounded in that
// real distribution: 6+ now reads "low" (thin evidence), distinguishing a near-total outage from
// a single isolated gap.
const sixUnavailable: BieUnavailableSource[] = Array.from({ length: 6 }, (_, i) => ({
  source: `source-${i}`,
  reason: "unavailable",
  what_is_missing: "a fresh read",
  retryable: true,
}));
const eightUnavailable: BieUnavailableSource[] = Array.from({ length: 8 }, (_, i) => ({
  source: `source-${i}`,
  reason: "unavailable",
  what_is_missing: "a fresh read",
  retryable: true,
}));

test("swingPlayBriefConfidence: 5 unavailable sources still reads moderate (just below the low-tier threshold, no regression)", () => {
  const fiveUnavailable: BieUnavailableSource[] = Array.from({ length: 5 }, (_, i) => ({
    source: `source-${i}`,
    reason: "unavailable",
    what_is_missing: "a fresh read",
    retryable: true,
  }));
  const play = fixturePlay({ status: "OPEN", entryPresentPillars: null });
  const c = swingPlayBriefConfidence(play, "open", fiveUnavailable);
  assert.equal(c.level, "moderate");
});

test("swingPlayBriefConfidence: 6 unavailable sources reads low, not moderate (live TSLA/SHOP repro — thin evidence must be distinguishable from a single gap)", () => {
  const play = fixturePlay({ status: "WATCH", entryPresentPillars: null });
  const c = swingPlayBriefConfidence(play, "watch", sixUnavailable);
  assert.equal(c.level, "low");
  assert.match(c.why, /thin/i);
  assert.match(c.why, /^6 sources /);
});

test("swingPlayBriefConfidence: 8 unavailable sources (live MRNA/RNG repro — near-total outage) reads low, same as 6, not a false 'high'/'moderate' read", () => {
  const play = fixturePlay({ status: "OPEN", entryPresentPillars: null });
  const c = swingPlayBriefConfidence(play, "open", eightUnavailable);
  assert.equal(c.level, "low");
  assert.match(c.why, /^8 sources /);
});

test("swingPlayBriefConfidence: the low-tier threshold does not override the thin-entry-evidence gate (entryPresentPillars still dominates)", () => {
  const play = fixturePlay({ status: "OPEN", entryPresentPillars: 2 });
  const c = swingPlayBriefConfidence(play, "open", eightUnavailable);
  assert.equal(c.level, "low");
  assert.match(c.why, /2\/7 pillars grounded/, "must still cite the thin-entry reason, not the source count");
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
