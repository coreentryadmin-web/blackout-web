import { test } from "node:test";
import assert from "node:assert/strict";
import { overlayLegacyOptionMarks, type LegacyOptionMarkRow } from "./use-legacy-option-marks.ts";
import type { TerminalPlay } from "./types.ts";

function basePlay(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "LEGACY:TEST",
    ticker: "TEST",
    direction: "LONG",
    contract: "TEST $50 CALL",
    occ: "TESTYYMMDDC00050000",
    score: 42,
    status: "WATCH",
    horizon: "LEGACY",
    exitModel: "PLAN",
    factors: [],
    gates: [],
    recommendation: "HOLD",
    entryCostPerContract: 2.0,
    ...overrides,
  } as TerminalPlay;
}

function markRow(overrides: Partial<LegacyOptionMarkRow> = {}): LegacyOptionMarkRow {
  return {
    occ: "TESTYYMMDDC00050000",
    mark: 3.0,
    bid: 2.8,
    ask: 3.2,
    asof: "2026-10-31T10:00:00Z",
    stale: false,
    ...overrides,
  };
}

// BUG FIX regression (2026-10-31): a WATCH or SKIP play has not been entered yet, so a real option
// quote against the published entry premium must never produce a live pnlPct/execPnlPct — that is
// exactly what the board's own status badge invariant promises ("never WATCH... not-yet-entered
// plays have no real pnlPct", legacy-board-table-utils.ts) but this overlay bypassed with no status
// check at all.

test("overlayLegacyOptionMarks: WATCH play gets no pnlPct/execPnlPct from a real option quote (RED pre-fix)", () => {
  const plays = [basePlay({ status: "WATCH" })];
  const marks = new Map([["TESTYYMMDDC00050000", markRow()]]);
  const result = overlayLegacyOptionMarks(plays, marks);
  assert.equal(result[0].pnlPct, null);
  assert.equal(result[0].execPnlPct, null);
  assert.equal(result[0].execMark, null);
});

test("overlayLegacyOptionMarks: SKIP (pulled/invalidated) play also gets no pnlPct/execPnlPct", () => {
  const plays = [basePlay({ status: "SKIP" })];
  const marks = new Map([["TESTYYMMDDC00050000", markRow()]]);
  const result = overlayLegacyOptionMarks(plays, marks);
  assert.equal(result[0].pnlPct, null);
  assert.equal(result[0].execPnlPct, null);
  assert.equal(result[0].execMark, null);
});

test("overlayLegacyOptionMarks: WATCH play still gets a live mark + markAsOf (informational, not a P&L claim)", () => {
  const plays = [basePlay({ status: "WATCH" })];
  const marks = new Map([["TESTYYMMDDC00050000", markRow({ mark: 3.0, asof: "2026-10-31T10:00:00Z" })]]);
  const result = overlayLegacyOptionMarks(plays, marks);
  assert.equal(result[0].mark, 3.0);
  assert.equal(result[0].markAsOf, "2026-10-31T10:00:00Z");
});

test("overlayLegacyOptionMarks: WATCH play's peak/trough are not latched from the withheld pnlPct", () => {
  const plays = [basePlay({ status: "WATCH", peak: null, trough: null })];
  const marks = new Map([["TESTYYMMDDC00050000", markRow({ mark: 10.0 })]]); // would be +400% if computed
  const result = overlayLegacyOptionMarks(plays, marks);
  assert.equal(result[0].peak, null);
  assert.equal(result[0].trough, null);
});

test("overlayLegacyOptionMarks: OPEN (morning-confirmed) play DOES get a real pnlPct/execPnlPct (GREEN control)", () => {
  const plays = [basePlay({ status: "OPEN" })];
  const marks = new Map([["TESTYYMMDDC00050000", markRow({ mark: 3.0, bid: 2.8 })]]);
  const result = overlayLegacyOptionMarks(plays, marks);
  // entry 2.0 -> mark 3.0 => +50%
  assert.equal(result[0].pnlPct, 50);
  // entry 2.0 -> bid 2.8 => +40%
  assert.equal(result[0].execPnlPct, 40);
  assert.equal(result[0].execMark, 2.8);
});

test("overlayLegacyOptionMarks: HOLD/TRIM plays (already-open management states) also get a real pnlPct", () => {
  for (const status of ["HOLD", "TRIM"] as const) {
    const plays = [basePlay({ status })];
    const marks = new Map([["TESTYYMMDDC00050000", markRow({ mark: 1.5 })]]);
    const result = overlayLegacyOptionMarks(plays, marks);
    assert.equal(result[0].pnlPct, -25, `status ${status} should still compute a live pnlPct`);
  }
});

test("overlayLegacyOptionMarks: CLOSED play still gets a pnlPct from a real quote (unchanged by this fix)", () => {
  const plays = [basePlay({ status: "CLOSED" })];
  const marks = new Map([["TESTYYMMDDC00050000", markRow({ mark: 4.0 })]]);
  const result = overlayLegacyOptionMarks(plays, marks);
  assert.equal(result[0].pnlPct, 100);
});

test("overlayLegacyOptionMarks: no entry premium -> only mark/markAsOf stamped regardless of status (unchanged)", () => {
  const plays = [basePlay({ status: "WATCH", entryCostPerContract: null })];
  const marks = new Map([["TESTYYMMDDC00050000", markRow({ mark: 3.0, asof: "T1" })]]);
  const result = overlayLegacyOptionMarks(plays, marks);
  assert.equal(result[0].mark, 3.0);
  assert.equal(result[0].markAsOf, "T1");
  assert.equal(result[0].pnlPct, undefined);
});

test("overlayLegacyOptionMarks: empty marks map -> plays returned unchanged (same reference)", () => {
  const plays = [basePlay()];
  const result = overlayLegacyOptionMarks(plays, new Map());
  assert.equal(result, plays);
});

test("overlayLegacyOptionMarks: no resolvable OCC -> play passed through unchanged", () => {
  const plays = [basePlay({ occ: null })];
  const marks = new Map([["TESTYYMMDDC00050000", markRow()]]);
  const result = overlayLegacyOptionMarks(plays, marks);
  assert.equal(result[0], plays[0]);
});
