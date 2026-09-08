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
