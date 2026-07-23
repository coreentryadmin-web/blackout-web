import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateBoard, openPositionsFromLedger, type BoardSetupLike } from "./board-allocation.ts";
import { sectorFor } from "./sector-map.ts";

test("sectorFor maps the liquid universe; unknown → null", () => {
  assert.equal(sectorFor("NVDA"), "semis");
  assert.equal(sectorFor("amd"), "semis"); // case-insensitive
  assert.equal(sectorFor("SPY"), "index-etf");
  assert.equal(sectorFor("COIN"), "crypto-equity");
  assert.equal(sectorFor("ZZZQ"), null);
  assert.equal(sectorFor(null), null);
});

test("board setups get ranked, and same-sector same-direction is one thesis", () => {
  const setups: BoardSetupLike[] = [
    { ticker: "NVDA", direction: "long", score: 82 },
    { ticker: "AMD", direction: "long", score: 81 },
    { ticker: "JPM", direction: "long", score: 70 },
  ];
  const { byTicker } = allocateBoard(setups);
  assert.equal(byTicker.get("NVDA")!.rank, 1);
  assert.equal(byTicker.get("NVDA")!.clusterRole, "PRIMARY");
  assert.equal(byTicker.get("AMD")!.clusterRole, "REDUNDANT"); // same semis-long thesis as NVDA
  assert.equal(byTicker.get("AMD")!.sizing, "SKIP"); // duplicate of the covered thesis
  assert.equal(byTicker.get("JPM")!.clusterRole, "PRIMARY"); // different sector → its own edge
  assert.notEqual(byTicker.get("JPM")!.sizing, "SKIP"); // taken (HALF here — it's the weak tail of a 3-name set)
});

test("open positions from the ledger create opportunity cost", () => {
  const setups: BoardSetupLike[] = [{ ticker: "AMD", direction: "long", score: 88 }];
  const open = openPositionsFromLedger([
    { ticker: "NVDA", direction: "long", status: "HOLD" }, // already long the semis thesis
    { ticker: "TSLA", direction: "long", status: "CLOSED" }, // closed → not open, ignored
  ]);
  assert.equal(open.length, 1);
  const { byTicker } = allocateBoard(setups, open);
  assert.equal(byTicker.get("AMD")!.clusterRole, "REDUNDANT"); // covered by the open NVDA position
  assert.equal(byTicker.get("AMD")!.sizing, "SKIP");
});

test("direction maps long→LONG / short→SHORT; a long and a short in one sector are distinct", () => {
  const { byTicker } = allocateBoard([
    { ticker: "NVDA", direction: "long", score: 82 },
    { ticker: "INTC", direction: "short", score: 80 },
  ]);
  assert.equal(byTicker.get("NVDA")!.direction, "LONG");
  assert.equal(byTicker.get("INTC")!.direction, "SHORT");
  assert.equal(byTicker.get("NVDA")!.clusterRole, "PRIMARY");
  assert.equal(byTicker.get("INTC")!.clusterRole, "PRIMARY"); // long-semis ≠ short-semis
});

test("EV, when present, drives the rank over score", () => {
  const { byTicker } = allocateBoard([
    { ticker: "NVDA", direction: "long", score: 90, ev: 0.3 },
    { ticker: "JPM", direction: "long", score: 80, ev: 0.9 },
  ]);
  assert.equal(byTicker.get("JPM")!.rank, 1); // higher EV outranks higher score
});

test("empty board → empty decisions (no crash)", () => {
  const { decisions } = allocateBoard([]);
  assert.equal(decisions.length, 0);
});
