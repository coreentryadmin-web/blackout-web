import test from "node:test";
import assert from "node:assert/strict";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import type { HorizonPlay } from "@/lib/horizon-plays";
import { computeLaneRank, laneRankSection, parseDeckContractLabel } from "./play-brief-lane-rank";

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

function row(
  ticker: string,
  score: number,
  status: HorizonPlay["status"],
  contract?: { strike: number; right: "C" | "P" },
  manageAction?: HorizonPlay["manageAction"],
): HorizonPlay {
  const c = contract ?? { strike: 100, right: "C" as const };
  return {
    ticker,
    direction: "LONG",
    score,
    status,
    reason: "",
    contract: { strike: c.strike, right: c.right, expiry: "2026-09-20", dte: 14, mid: 1, delta: 0.5, gamma: 0, theta: 0, vega: 0, iv: 0.3 },
    factors: [],
    manageAction,
  };
}

test("computeLaneRank: ranks OPEN play among COMMIT peers (real HorizonPlay shape)", () => {
  const lanes = [row("NRG", 45, "COMMIT"), row("CRWD", 70, "COMMIT"), row("AAPL", 30, "COMMIT")];
  const snap = computeLaneRank(play({ ticker: "NRG", score: 45 }), lanes);
  assert.ok(snap);
  assert.equal(snap!.rank, 2);
  assert.equal(snap!.total, 3);
  assert.equal(snap!.medianScore, 45);
});

test("computeLaneRank: null when lane rows use DeckStatus literals (pre-fix bug shape)", () => {
  const lanes = [row("NRG", 45, "HOLD"), row("CRWD", 70, "OPEN")];
  const snap = computeLaneRank(play({ score: 45 }), lanes);
  assert.equal(snap, null, "HOLD/OPEN on HorizonPlay are not real — peers filter must use COMMIT");
});

test("laneRankSection: null for closed plays", () => {
  assert.equal(laneRankSection(play({ status: "CLOSED" }), [row("NRG", 50, "COMMIT")]), null);
});

test("laneRankSection: renders rank line for committed peers", () => {
  const sec = laneRankSection(play({ ticker: "NRG", score: 70 }), [row("NRG", 70, "COMMIT"), row("X", 40, "COMMIT")]);
  assert.ok(sec);
  assert.match(sec!.body, /#1 of 2/);
});

test("parseDeckContractLabel: extracts strike and right from deck label", () => {
  assert.deepEqual(parseDeckContractLabel("110C · 13DTE"), { strike: 110, right: "C" });
  assert.deepEqual(parseDeckContractLabel("192.5P · 0DTE"), { strike: 192.5, right: "P" });
  assert.deepEqual(parseDeckContractLabel(""), { strike: null, right: null });
});

test("computeLaneRank: disambiguates same-ticker WATCH rows by contract", () => {
  const lanes = [
    row("NRG", 70, "WATCH", { strike: 115, right: "C" }),
    row("NRG", 40, "WATCH", { strike: 110, right: "C" }),
  ];
  const snap = computeLaneRank(play({ ticker: "NRG", contract: "110C · 14DTE", score: 40, status: "WATCH" }), lanes);
  assert.ok(snap);
  assert.equal(snap!.rank, 2, "110C ranks second behind 115C — ticker-only match would wrongly rank #1");
  assert.equal(snap!.playScore, 40);
});

test("computeLaneRank: named leader skips a peer whose own manage engine says EXIT/EXIT_RUNNER", () => {
  // Live repro 2026-09-12: CRWD sat #1 by score (86.5) among real OPEN positions while its own
  // manage engine had already fired EXIT_RUNNER (round-tripped from +129.7% peak to -9.5%). NN's
  // brief still named "Leader: CRWD @ 86.5 — confirm before adding size" — reads as "put money
  // here" about a position the desk is telling members to exit.
  const lanes = [
    row("CRWD", 86.5, "COMMIT", undefined, "EXIT_RUNNER"),
    row("AAPL", 84.4, "COMMIT", undefined, "HOLD"),
    row("NN", 23, "COMMIT", undefined, "HOLD"),
  ];
  const snap = computeLaneRank(play({ ticker: "NN", score: 23 }), lanes);
  assert.ok(snap);
  assert.equal(snap!.topTicker, "AAPL", "the raw #1 (CRWD) is exiting — the named leader must skip it");
  assert.equal(snap!.topScore, 84.4);
  assert.equal(snap!.rank, 3, "rank still reflects the FULL peer set, exit state doesn't change standing");
  assert.equal(snap!.total, 3);
});

test("computeLaneRank: named leader falls back to the raw #1 when every peer is exiting", () => {
  const lanes = [
    row("CRWD", 86.5, "COMMIT", undefined, "EXIT_RUNNER"),
    row("NRG", 27.2, "COMMIT", undefined, "EXIT"),
  ];
  const snap = computeLaneRank(play({ ticker: "NRG", score: 27.2 }), lanes);
  assert.ok(snap);
  assert.equal(snap!.topTicker, "CRWD", "no non-exiting peer exists — fall back rather than show nothing");
});

test("computeLaneRank: WATCH-bucket rows never carry manageAction — leader pick unaffected", () => {
  const lanes = [row("NRG", 70, "WATCH"), row("FSLR", 40, "WATCH")];
  const snap = computeLaneRank(play({ ticker: "FSLR", score: 40, status: "WATCH" }), lanes);
  assert.ok(snap);
  assert.equal(snap!.topTicker, "NRG");
});

test("computeLaneRank: deltaFromMedian is rounded, not a raw float subtraction artifact", () => {
  const snap = computeLaneRank(play({ ticker: "AMZN", score: 57.2, status: "WATCH" }), [
    row("AMZN", 57.2, "WATCH"),
    row("FSLR", 45.4, "WATCH"),
  ]);
  assert.ok(snap);
  // Live repro (AMZN brief, 2026-09-09): 57.2 - 45.4 === 11.800000000000004 in raw IEEE754 math.
  assert.equal(snap!.deltaFromMedian, 11.8, "must round to 1dp, not leak 11.800000000000004 into the narrative");
});
