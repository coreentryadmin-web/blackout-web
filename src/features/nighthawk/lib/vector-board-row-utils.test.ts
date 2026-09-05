import assert from "node:assert/strict";
import { test } from "node:test";
import type { VectorBoardTableRow } from "./vector-board-table-utils";
import {
  vectorBoardExportCsv,
  vectorBoardRowAtRisk,
  vectorBoardRowIsLive,
  vectorBoardScorecard,
  vectorBoardSparklinePoints,
  vectorBoardTradeTicket,
} from "./vector-board-row-utils";

function row(partial: Partial<VectorBoardTableRow>): VectorBoardTableRow {
  return {
    key: "k1",
    kind: "live",
    status: "open",
    statusLabel: "Open",
    ticker: "NVDA",
    contractLabel: "180C",
    occ: "NVDA180C",
    sessionDate: "2026-09-01",
    rank: 1,
    tier: "elite",
    entryMid: 4.5,
    markMid: 5.0,
    premiumPct: 10,
    peakPct: 30,
    progressPct: 33,
    reason: "test",
    timestamp: new Date().toISOString(),
    setupInvalidated: false,
    ...partial,
  };
}

test("vectorBoardRowAtRisk flags caution and giveback", () => {
  assert.equal(vectorBoardRowAtRisk(row({ status: "caution" })), true);
  assert.equal(vectorBoardRowAtRisk(row({ premiumPct: 5, peakPct: 40 })), true);
  assert.equal(vectorBoardRowAtRisk(row({ premiumPct: 25, peakPct: 30 })), false);
});

test("vectorBoardRowIsLive: row within 60s window is live", () => {
  const now = 1_000_000;
  assert.equal(
    vectorBoardRowIsLive(row({ timestamp: new Date(now - 30_000).toISOString() }), now),
    true,
  );
});

test("vectorBoardRowIsLive: far-future timestamp is not live forever", () => {
  const now = 1_000_000;
  assert.equal(
    vectorBoardRowIsLive(row({ timestamp: new Date(now + 60_000).toISOString() }), now),
    false,
  );
});

test("vectorBoardRowIsLive: closed rows are never live", () => {
  assert.equal(vectorBoardRowIsLive(row({ kind: "closed", status: "closed" })), false);
});

test("vectorBoardScorecard computes hit rate and meters inputs", () => {
  const sc = vectorBoardScorecard([
    row({ status: "winner", premiumPct: 60 }),
    row({ status: "runner", premiumPct: 20, kind: "runner" }),
    row({ kind: "closed", status: "closed", premiumPct: -10 }),
  ]);
  assert.equal(sc.total, 3);
  assert.equal(sc.winners, 1);
  assert.ok(sc.netPremiumPct != null);
});

test("vectorBoardSparklinePoints returns entry-to-mark path", () => {
  const pts = vectorBoardSparklinePoints(row({ premiumPct: 20, peakPct: 40 }));
  assert.ok(pts.length >= 3);
  assert.equal(pts[0], 0);
});

test("vectorBoardTradeTicket and export csv", () => {
  const ticket = vectorBoardTradeTicket(row({}));
  assert.match(ticket, /NVDA/);
  const csv = vectorBoardExportCsv([row({})]);
  assert.match(csv, /Ticker/);
  assert.match(csv, /NVDA/);
});
