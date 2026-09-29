import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sectionForSwingPlay,
  buildSwingSections,
  observablesFromHorizonPlay,
  emptySwingSections,
  SWING_SERVING_SECTIONS,
  type SwingServingObservables,
} from "./serving.ts";
import type { HorizonPlay } from "../horizon-plays.ts";
import type { ChainContract } from "../horizon-fanout.ts";

// ── router: pre-entry sections keyed on OBSERVABLE state, never on the score ──────────────────────

test("82-pt AT_TRIGGER, floor cleared, bucket GRADUATED → COMMIT_NOW", () => {
  assert.equal(
    sectionForSwingPlay({
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      aboveFloor: true,
      bucketGraduated: true,
    }),
    "COMMIT_NOW",
  );
});

test("AT_TRIGGER + floor cleared, bucket NOT graduated → STILL COMMIT_NOW (graduation is evidence-only, 2026-08-06)", () => {
  assert.equal(
    sectionForSwingPlay({
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      aboveFloor: true,
      bucketGraduated: false,
    }),
    "COMMIT_NOW",
  );
  assert.equal(
    sectionForSwingPlay({ setupState: "TRIGGERED", entryStatus: "AT_TRIGGER", aboveFloor: true }),
    "COMMIT_NOW",
    "absent bucketGraduated no longer withholds COMMIT_NOW — the real-time gates in commit.ts decide, not calibration",
  );
});

test("91-pt EXTENDED, not yet entered → WAITING_FOR_ENTRY (high score does NOT force COMMIT_NOW)", () => {
  // The 91 is irrelevant — the OBSERVABLE fact is the move ran past the trigger, so there's no clean fill.
  assert.equal(
    sectionForSwingPlay({ setupState: "EXTENDED", entryStatus: "PRE_TRIGGER", aboveFloor: true }),
    "WAITING_FOR_ENTRY",
  );
});

test("TRIGGERED but pulling back / pre-trigger / chasing → WAITING_FOR_ENTRY", () => {
  for (const entryStatus of ["PRE_TRIGGER", "PULLBACK_TO_ENTRY", "EXTENDED_CHASE"] as const) {
    assert.equal(
      sectionForSwingPlay({ setupState: "TRIGGERED", entryStatus, aboveFloor: true }),
      "WAITING_FOR_ENTRY",
      `entryStatus ${entryStatus}`,
    );
  }
});

test("FORMING → WATCH; a real contract under the floor → WATCH (not COMMIT_NOW even at trigger)", () => {
  assert.equal(sectionForSwingPlay({ setupState: "FORMING", aboveFloor: true }), "WATCH");
  // Below floor: mechanical gate result keeps a triggered-at-trigger name out of COMMIT_NOW.
  assert.equal(
    sectionForSwingPlay({ setupState: "TRIGGERED", entryStatus: "AT_TRIGGER", aboveFloor: false }),
    "WATCH",
  );
});

test("INVALIDATED or unclassified → RESEARCH", () => {
  assert.equal(sectionForSwingPlay({ setupState: "INVALIDATED", aboveFloor: true }), "RESEARCH");
  assert.equal(sectionForSwingPlay({}), "RESEARCH"); // no setup read at all
});

test("persistenceObserved → RESEARCH even when triggered (below cross-session bar)", () => {
  assert.equal(
    sectionForSwingPlay({
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      aboveFloor: true,
      bucketGraduated: true,
      persistenceObserved: true,
    }),
    "RESEARCH",
  );
});

// ── router: live-position management sections, by management action / thesis level ────────────────

test("live OPEN + thesis intact → MANAGING", () => {
  assert.equal(
    sectionForSwingPlay({ liveStatus: "OPEN", manageAction: "HOLD", thesisLevel: "intact" }),
    "MANAGING",
  );
});

test("live TRIM or profit-ladder action → SCALING_OUT", () => {
  assert.equal(sectionForSwingPlay({ liveStatus: "TRIM" }), "SCALING_OUT");
  assert.equal(sectionForSwingPlay({ liveStatus: "OPEN", manageAction: "TAKE_PARTIAL" }), "SCALING_OUT");
  assert.equal(sectionForSwingPlay({ liveStatus: "HOLD", manageAction: "EXIT_RUNNER" }), "SCALING_OUT");
});

test("live position with thesis break / EXIT / STOP_OUT → EXITING (wins over scale/manage)", () => {
  assert.equal(sectionForSwingPlay({ liveStatus: "OPEN", thesisLevel: "break" }), "EXITING");
  assert.equal(sectionForSwingPlay({ liveStatus: "HOLD", manageAction: "EXIT" }), "EXITING");
  assert.equal(sectionForSwingPlay({ liveStatus: "TRIM", manageAction: "STOP_OUT" }), "EXITING");
});

test("live position precedence dominates pre-entry state", () => {
  // Even a FORMING setup, if it is a live position, routes on the live path.
  const o: SwingServingObservables = { liveStatus: "OPEN", setupState: "FORMING", manageAction: "HOLD" };
  assert.equal(sectionForSwingPlay(o), "MANAGING");
});

// ── extraction + grouping over produced HorizonPlays ──────────────────────────────────────────────

const contract: ChainContract = {
  ticker: "AAA", right: "C", expiry: "2026-08-07", dte: 14, strike: 100,
  delta: 0.6, openInterest: 3000, bid: 1.2, ask: 1.3, mid: 1.25,
};

function swingPlay(over: Partial<HorizonPlay>): HorizonPlay {
  return {
    ticker: "AAA", direction: "LONG", horizon: "SWING", score: 80, status: "COMMIT",
    contract, scoreFloor: 60, reason: "test", ...over,
  };
}

test("observablesFromHorizonPlay: aboveFloor is the COMMIT/WATCH gate, not the raw score", () => {
  assert.equal(observablesFromHorizonPlay(swingPlay({ status: "COMMIT" })).aboveFloor, true);
  assert.equal(observablesFromHorizonPlay(swingPlay({ status: "WATCH" })).aboveFloor, false);
});

test("buildSwingSections groups plays into the seven sections and stamps `serving`", () => {
  const sections = buildSwingSections([
    swingPlay({
      ticker: "COM",
      setupState: "TRIGGERED",
      entryStatus: "AT_TRIGGER",
      status: "COMMIT",
      bucketGraduated: true,
    }),
    swingPlay({ ticker: "EXT", setupState: "EXTENDED", entryStatus: "PRE_TRIGGER", status: "COMMIT" }),
    swingPlay({ ticker: "WAT", setupState: "FORMING", status: "COMMIT" }),
    swingPlay({ ticker: "UNDER", setupState: "TRIGGERED", entryStatus: "AT_TRIGGER", status: "WATCH" }),
    swingPlay({ ticker: "RES", setupState: "INVALIDATED", status: "COMMIT" }),
  ]);
  assert.equal(sections.COMMIT_NOW[0]!.ticker, "COM");
  assert.equal(sections.COMMIT_NOW[0]!.serving, "COMMIT_NOW"); // stamped
  assert.equal(sections.WAITING_FOR_ENTRY[0]!.ticker, "EXT");
  assert.deepEqual(sections.WATCH.map((p) => p.ticker), ["WAT", "UNDER"]);
  assert.equal(sections.RESEARCH[0]!.ticker, "RES");
  assert.equal(sections.MANAGING.length, 0);
});

test("emptySwingSections has all seven keys present", () => {
  const empty = emptySwingSections();
  for (const s of SWING_SERVING_SECTIONS) assert.ok(Array.isArray(empty[s]), s);
  assert.equal(SWING_SERVING_SECTIONS.length, 7);
});

// ── stale WATCH candidates whose entry-validity deadline lapsed (FINDINGS.md
//    `watch-board-stale-expired-candidates-not-pruned`, logged 2026-09-12, live repro: META, first
//    flagged 2026-08-26, sat #1 in `sections.WATCH` at score 84.7, 26+ days past its own entry
//    window) — the router must route these to RESEARCH, overriding whatever setup/entry geometry
//    happens to read, and never for a live position. ───────────────────────────────────────────────

test("entryWindowExpired overrides setup maturity → RESEARCH even from what would otherwise be COMMIT_NOW/WATCH/WAITING_FOR_ENTRY", () => {
  assert.equal(
    sectionForSwingPlay({ setupState: "TRIGGERED", entryStatus: "AT_TRIGGER", aboveFloor: true, entryWindowExpired: true }),
    "RESEARCH",
    "would otherwise be COMMIT_NOW",
  );
  assert.equal(
    sectionForSwingPlay({ setupState: "FORMING", aboveFloor: true, entryWindowExpired: true }),
    "RESEARCH",
    "would otherwise be WATCH",
  );
  assert.equal(
    sectionForSwingPlay({ setupState: "TRIGGERED", entryStatus: "PRE_TRIGGER", aboveFloor: true, entryWindowExpired: true }),
    "RESEARCH",
    "would otherwise be WAITING_FOR_ENTRY",
  );
});

test("entryWindowExpired absent/false → normal routing unaffected (no regression on the common case)", () => {
  assert.equal(
    sectionForSwingPlay({ setupState: "TRIGGERED", entryStatus: "AT_TRIGGER", aboveFloor: true, entryWindowExpired: false }),
    "COMMIT_NOW",
  );
  assert.equal(sectionForSwingPlay({ setupState: "FORMING", aboveFloor: true }), "WATCH");
});

test("live position ignores entryWindowExpired entirely (liveStatus routes first)", () => {
  assert.equal(
    sectionForSwingPlay({ liveStatus: "OPEN", manageAction: "HOLD", thesisLevel: "intact", entryWindowExpired: true }),
    "MANAGING",
  );
});

function stalePlay(over: Partial<HorizonPlay> = {}): HorizonPlay {
  return swingPlay({
    ticker: "META",
    setupState: "FORMING",
    status: "WATCH",
    score: 84.7,
    firstSeenAt: new Date(Date.now() - 26 * 24 * 60 * 60 * 1000).toISOString(),
    subLane: "STANDARD", // 3-day window — 26 days is unambiguously past it
    ...over,
  });
}

test("observablesFromHorizonPlay: a WATCH play 26 days past its (STANDARD) 3-day entry window reads entryWindowExpired", () => {
  const observables = observablesFromHorizonPlay(stalePlay());
  assert.equal(observables.entryWindowExpired, true);
});

test("observablesFromHorizonPlay: a fresh WATCH play (1 hour old) does NOT read entryWindowExpired", () => {
  const observables = observablesFromHorizonPlay(
    stalePlay({ firstSeenAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() }),
  );
  assert.notEqual(observables.entryWindowExpired, true);
});

test("observablesFromHorizonPlay: a live position never reads entryWindowExpired, even with a stale firstSeenAt", () => {
  const observables = observablesFromHorizonPlay(
    stalePlay({ liveStatus: "OPEN", committedAt: new Date(Date.now() - 26 * 24 * 60 * 60 * 1000).toISOString() }),
  );
  assert.notEqual(observables.entryWindowExpired, true);
});

test("buildSwingSections: the live META repro (26 days stale, score 84.7) lands in RESEARCH, stamped watchEntryExpired, not #1 in WATCH", () => {
  const sections = buildSwingSections([stalePlay(), swingPlay({ ticker: "FRESH", setupState: "FORMING", status: "WATCH" })]);
  assert.deepEqual(sections.WATCH.map((p) => p.ticker), ["FRESH"], "the stale row must not occupy WATCH at all");
  assert.deepEqual(sections.RESEARCH.map((p) => p.ticker), ["META"]);
  assert.equal(sections.RESEARCH[0]!.watchEntryExpired, true);
  assert.equal(sections.RESEARCH[0]!.serving, "RESEARCH");
});
