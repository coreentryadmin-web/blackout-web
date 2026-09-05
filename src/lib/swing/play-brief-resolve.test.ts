import test from "node:test";
import assert from "node:assert/strict";
import type { HorizonPlay } from "@/lib/horizon-plays";
import { pickLanePlayForBrief, parseSwingPlayId } from "./play-brief-resolve-pure";

function laneRow(overrides: Partial<HorizonPlay> & { ticker: string }): HorizonPlay {
  return {
    ticker: overrides.ticker,
    direction: overrides.direction ?? "LONG",
    horizon: "SWING",
    score: overrides.score ?? 70,
    status: overrides.status ?? "WATCH",
    contract: overrides.contract ?? {
      ticker: overrides.ticker,
      strike: 100,
      right: "C",
      expiry: "2026-09-20",
      dte: 13,
      mid: 5,
      bid: 4.9,
      ask: 5.1,
      delta: 0.5,
      openInterest: 1000,
    },
    scoreFloor: 60,
    reason: overrides.reason ?? "test",
    liveStatus: overrides.liveStatus,
    livePnlPct: overrides.livePnlPct,
    ...overrides,
  };
}

test("parseSwingPlayId: extracts ticker and position id", () => {
  assert.deepEqual(parseSwingPlayId("SWING:NRG"), { ticker: "NRG", positionId: null });
  assert.deepEqual(parseSwingPlayId("SWING:AAPL:36"), { ticker: "AAPL", positionId: 36 });
});

test("pickLanePlayForBrief: prefers live OPEN row over WATCH when status hint is HOLD", () => {
  const rows = [
    laneRow({
      ticker: "NRG",
      score: 62,
      contract: { ticker: "NRG", strike: 115, right: "C", expiry: "x", dte: 14, mid: 3, bid: null, ask: null, delta: 0.4, openInterest: 0 },
    }),
    laneRow({
      ticker: "NRG",
      score: 27,
      liveStatus: "HOLD",
      livePnlPct: 98,
      contract: { ticker: "NRG", strike: 110, right: "C", expiry: "x", dte: 13, mid: 9, bid: null, ask: null, delta: 0.5, openInterest: 0 },
    }),
  ];
  const picked = pickLanePlayForBrief(rows, "NRG", { status: "HOLD", strike: 110, right: "C" });
  assert.equal(picked?.contract.strike, 110);
  assert.equal(picked?.liveStatus, "HOLD");
});

test("pickLanePlayForBrief: prefers live OPEN row over WATCH when status hint absent", () => {
  const rows = [
    laneRow({
      ticker: "NRG",
      score: 62,
      contract: { ticker: "NRG", strike: 115, right: "C", expiry: "x", dte: 14, mid: 3, bid: null, ask: null, delta: 0.4, openInterest: 0 },
    }),
    laneRow({
      ticker: "NRG",
      score: 27,
      liveStatus: "HOLD",
      livePnlPct: 98,
      contract: { ticker: "NRG", strike: 110, right: "C", expiry: "x", dte: 13, mid: 9, bid: null, ask: null, delta: 0.5, openInterest: 0 },
    }),
  ];
  const picked = pickLanePlayForBrief(rows, "NRG", {});
  assert.equal(picked?.contract.strike, 110);
  assert.equal(picked?.liveStatus, "HOLD");
});

test("pickLanePlayForBrief: contract strike disambiguates same ticker", () => {
  const rows = [
    laneRow({
      ticker: "META",
      contract: { ticker: "META", strike: 570, right: "C", expiry: "x", dte: 9, mid: 10, bid: null, ask: null, delta: 0.45, openInterest: 0 },
    }),
    laneRow({
      ticker: "META",
      score: 50,
      contract: { ticker: "META", strike: 580, right: "C", expiry: "x", dte: 14, mid: 8, bid: null, ask: null, delta: 0.4, openInterest: 0 },
    }),
  ];
  const picked = pickLanePlayForBrief(rows, "META", { strike: 580, right: "C" });
  assert.equal(picked?.contract.strike, 580);
});
