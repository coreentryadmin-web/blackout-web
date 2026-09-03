import assert from "node:assert/strict";
import test from "node:test";
import type { TerminalPlay } from "./types";
import {
  buildDeckCommandCenterStats,
  convictionRankContext,
  deriveTodaysEdge,
  topRatedPlay,
} from "./deck-command-center";

function play(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "0DTE:TEST",
    ticker: "TEST",
    direction: "LONG",
    contract: "100C · 0DTE",
    score: 80,
    status: "WATCH",
    horizon: "ZERO_DTE",
    exitModel: "RATCHET",
    factors: [],
    gates: [],
    recommendation: "HOLD",
    ...overrides,
  };
}

test("topRatedPlay picks highest conviction tier, not first row", () => {
  const board = [
    play({ id: "1", ticker: "AMD", tierLabel: "B", score: 90 }),
    play({ id: "2", ticker: "META", tierLabel: "A+", score: 70, confluence: 2 }),
    play({ id: "3", ticker: "NVDA", tierLabel: "A", score: 95 }),
  ];
  assert.deepEqual(topRatedPlay(board), { ticker: "META", grade: "A+" });
});

test("topRatedPlay returns null when no tier labels on the board", () => {
  assert.equal(topRatedPlay([play({ tierLabel: null })]), null);
});

test("deriveTodaysEdge: A+ on the board → High", () => {
  assert.equal(deriveTodaysEdge([play({ tierLabel: "A+" })]), "High");
});

test("deriveTodaysEdge: three A-tier names → High", () => {
  const board = [
    play({ id: "1", tierLabel: "A" }),
    play({ id: "2", tierLabel: "A" }),
    play({ id: "3", tierLabel: "A" }),
  ];
  assert.equal(deriveTodaysEdge(board), "High");
});

test("deriveTodaysEdge: one A-tier → Medium", () => {
  assert.equal(deriveTodaysEdge([play({ tierLabel: "A" })]), "Medium");
});

test("deriveTodaysEdge: deep board without A-tier → Medium", () => {
  const board = Array.from({ length: 6 }, (_, i) =>
    play({ id: String(i), ticker: `T${i}`, tierLabel: "B" }),
  );
  assert.equal(deriveTodaysEdge(board), "Medium");
});

test("deriveTodaysEdge: thin weak board → Low", () => {
  assert.equal(deriveTodaysEdge([play({ tierLabel: "C" }), play({ tierLabel: "D" })]), "Low");
});

test("deriveTodaysEdge: empty board → null", () => {
  assert.equal(deriveTodaysEdge([]), null);
});

test("buildDeckCommandCenterStats aggregates opportunities + top + edge", () => {
  const stats = buildDeckCommandCenterStats([
    play({ ticker: "META", tierLabel: "A+", status: "WATCH" }),
    play({ id: "2", ticker: "AMD", tierLabel: "B", status: "SKIP" }),
    play({ id: "3", ticker: "NVDA", tierLabel: "A", status: "OPEN" }),
  ]);
  assert.equal(stats.opportunities, 3);
  assert.equal(stats.scanned, 2);
  assert.equal(stats.committed, 1);
  assert.equal(stats.commitReady, 1);
  assert.equal(stats.gateBlocked, 1);
  assert.deepEqual(stats.topRated, { ticker: "META", grade: "A+" });
  assert.equal(stats.edge, "High");
});

test("convictionRankContext: rank on full board + highest today flag", () => {
  const board = [
    play({ id: "1", ticker: "AMD", tierLabel: "B", score: 90 }),
    play({ id: "2", ticker: "META", tierLabel: "A+", score: 70, confluence: 2 }),
    play({ id: "3", ticker: "NVDA", tierLabel: "A", score: 95 }),
  ];
  const meta = convictionRankContext(board, "2");
  assert.deepEqual(meta, { rank: 1, total: 3, isHighestToday: true });
  const nvda = convictionRankContext(board, "3");
  assert.equal(nvda?.rank, 2);
  assert.equal(nvda?.isHighestToday, false);
});
