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

test("82-pt AT_TRIGGER, floor cleared → COMMIT_NOW", () => {
  assert.equal(
    sectionForSwingPlay({ setupState: "TRIGGERED", entryStatus: "AT_TRIGGER", aboveFloor: true }),
    "COMMIT_NOW",
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
    swingPlay({ ticker: "COM", setupState: "TRIGGERED", entryStatus: "AT_TRIGGER", status: "COMMIT" }),
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
