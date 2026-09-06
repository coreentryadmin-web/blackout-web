import test from "node:test";
import assert from "node:assert/strict";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import type { HorizonPlay } from "@/lib/horizon-plays";
import { computeLaneRank, laneRankSection } from "./play-brief-lane-rank";

function play(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "SWING:NRG",
    ticker: "NRG",
    direction: "LONG",
    contract: "110C · 13DTE",
    score: 45,
    status: "HOLD",
    horizon: "SWING",
    exitModel: "SCALE_OUT",
    factors: [],
    gates: [],
    ...overrides,
  };
}

function row(ticker: string, score: number, status: HorizonPlay["status"]): HorizonPlay {
  return {
    ticker,
    direction: "LONG",
    score,
    status,
    reason: "",
    contract: { strike: 100, right: "C", expiry: "2026-09-20", dte: 14, mid: 1, delta: 0.5, gamma: 0, theta: 0, vega: 0, iv: 0.3 },
    factors: [],
  };
}

test("computeLaneRank: ranks OPEN play among peers", () => {
  const lanes = [row("NRG", 45, "HOLD"), row("CRWD", 70, "OPEN"), row("AAPL", 30, "TRIM")];
  const snap = computeLaneRank(play({ score: 45 }), lanes);
  assert.ok(snap);
  assert.equal(snap!.rank, 2);
  assert.equal(snap!.total, 3);
  assert.equal(snap!.medianScore, 45);
});

test("laneRankSection: null for closed plays", () => {
  assert.equal(laneRankSection(play({ status: "CLOSED" }), [row("NRG", 50, "HOLD")]), null);
});

test("laneRankSection: renders rank line", () => {
  const sec = laneRankSection(play({ score: 70 }), [row("NRG", 70, "HOLD"), row("X", 40, "OPEN")]);
  assert.ok(sec);
  assert.match(sec!.body, /#1 of 2/);
});

test("computeLaneRank: undefined laneRows does not throw", () => {
  assert.equal(computeLaneRank(play(), undefined), null);
  assert.equal(laneRankSection(play(), undefined), null);
});
