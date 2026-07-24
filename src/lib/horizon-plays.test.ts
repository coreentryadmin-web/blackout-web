import { test } from "node:test";
import assert from "node:assert/strict";
import {
  produceHorizonPlays,
  committedPlays,
  watchPlays,
  totalCommitted,
  type HorizonCandidate,
} from "./horizon-plays";

const ASOF = "2026-07-23";

// A candidate whose chain lists a liquid contract in all three windows (0DTE, Swing, LEAPS).
function fullChainCandidate(ticker: string, direction: "LONG" | "SHORT", score: number): HorizonCandidate {
  return {
    ticker,
    direction,
    score,
    asOfYmd: ASOF,
    chainRows: [
      { expiry: "2026-07-23", strike: 100, call_bid: 1.0, call_ask: 1.1, call_delta: 0.5, call_oi: 5000, put_bid: 1.0, put_ask: 1.1, put_delta: -0.5, put_oi: 5000 }, // 0DTE
      { expiry: "2026-08-06", strike: 108, call_bid: 1.2, call_ask: 1.3, call_delta: 0.6, call_oi: 3000, put_bid: 1.2, put_ask: 1.3, put_delta: -0.6, put_oi: 3000 }, // Swing (14 DTE), 0.50–0.75Δ directional stance
      { expiry: "2026-09-21", strike: 98, call_bid: 6.0, call_ask: 6.3, call_delta: 0.6, call_oi: 1500, put_bid: 6.0, put_ask: 6.3, put_delta: -0.6, put_oi: 1500 }, // LEAPS (60 DTE)
    ],
  };
}

test("one candidate fans out into all three lanes", () => {
  const set = produceHorizonPlays([fullChainCandidate("AAA", "LONG", 90)]);
  assert.equal(set.ZERO_DTE.length, 1);
  assert.equal(set.SWING.length, 1);
  assert.equal(set.LEAPS.length, 1);
  assert.equal(set.ZERO_DTE[0].contract.expiry, "2026-07-23");
  assert.equal(set.SWING[0].contract.expiry, "2026-08-06");
  assert.equal(set.LEAPS[0].contract.expiry, "2026-09-21");
});

test("COMMIT vs WATCH is stamped per lane floor (0DTE=65, Swing=60, LEAPS=62)", () => {
  // score 61: below 0DTE (65) and LEAPS (62), at/above Swing (60)
  const set = produceHorizonPlays([fullChainCandidate("BBB", "LONG", 61)]);
  assert.equal(set.ZERO_DTE[0].status, "WATCH"); // 61 < 65
  assert.equal(set.SWING[0].status, "COMMIT"); // 61 >= 60
  assert.equal(set.LEAPS[0].status, "WATCH"); // 61 < 62
});

test("high score commits every lane", () => {
  const set = produceHorizonPlays([fullChainCandidate("CCC", "LONG", 95)]);
  assert.equal(totalCommitted(set), 3);
});

test("LONG picks calls, SHORT picks puts", () => {
  const longSet = produceHorizonPlays([fullChainCandidate("DDD", "LONG", 90)]);
  const shortSet = produceHorizonPlays([fullChainCandidate("EEE", "SHORT", 90)]);
  assert.equal(longSet.ZERO_DTE[0].contract.right, "C");
  assert.equal(shortSet.ZERO_DTE[0].contract.right, "P");
});

test("a candidate with only a swing-window expiry appears only in Swing", () => {
  const cand: HorizonCandidate = {
    ticker: "FFF",
    direction: "LONG",
    score: 80,
    asOfYmd: ASOF,
    chainRows: [
      { expiry: "2026-08-06", strike: 100, call_bid: 1.2, call_ask: 1.3, call_delta: 0.6, call_oi: 2000, put_bid: 1, put_ask: 1.1, put_delta: -0.6, put_oi: 500 },
    ],
  };
  const set = produceHorizonPlays([cand]);
  assert.equal(set.ZERO_DTE.length, 0);
  assert.equal(set.SWING.length, 1);
  assert.equal(set.LEAPS.length, 0);
});

test("lanes are sorted by score descending", () => {
  const set = produceHorizonPlays([
    fullChainCandidate("LOW", "LONG", 70),
    fullChainCandidate("HIGH", "LONG", 92),
    fullChainCandidate("MID", "LONG", 81),
  ]);
  assert.deepEqual(
    set.SWING.map((p) => p.ticker),
    ["HIGH", "MID", "LOW"],
  );
});

test("committedPlays and watchPlays partition a lane by floor", () => {
  const set = produceHorizonPlays([
    fullChainCandidate("OVER", "LONG", 90), // commits 0DTE
    fullChainCandidate("UNDER", "LONG", 50), // watch on 0DTE (< 65)
  ]);
  assert.deepEqual(committedPlays(set, "ZERO_DTE").map((p) => p.ticker), ["OVER"]);
  assert.deepEqual(watchPlays(set, "ZERO_DTE").map((p) => p.ticker), ["UNDER"]);
});

test("empty candidate pool yields three empty lanes, not a crash", () => {
  const set = produceHorizonPlays([]);
  assert.deepEqual(set, { ZERO_DTE: [], SWING: [], LEAPS: [] });
  assert.equal(totalCommitted(set), 0);
});

test("per-horizon scoring: one name, different score per lens → different COMMIT/WATCH", () => {
  // Great 0DTE (hot flow, 90), mediocre Swing (55), no LEAPS thesis at all (omitted, no flat fallback).
  const cand = { ...fullChainCandidate("SPLIT", "LONG", 0), horizonScores: { ZERO_DTE: 90, SWING: 55 } };
  delete (cand as { score?: number }).score; // no flat fallback → LEAPS (unscored) must be absent
  const set = produceHorizonPlays([cand]);
  assert.equal(set.ZERO_DTE[0].status, "COMMIT"); // 90 >= 65
  assert.equal(set.ZERO_DTE[0].score, 90);
  assert.equal(set.SWING[0].status, "WATCH"); // 55 < 60
  assert.equal(set.SWING[0].score, 55);
  assert.equal(set.LEAPS.length, 0); // no LEAPS score → not in the lane at all
});

test("horizonScores wins over the flat score fallback, per lane", () => {
  const cand = { ...fullChainCandidate("MIX", "LONG", 40), horizonScores: { LEAPS: 88 } };
  const set = produceHorizonPlays([cand]);
  // 0DTE + Swing fall back to flat 40 (WATCH); LEAPS uses its own 88 (COMMIT)
  assert.equal(set.ZERO_DTE[0].status, "WATCH");
  assert.equal(set.ZERO_DTE[0].score, 40);
  assert.equal(set.LEAPS[0].status, "COMMIT");
  assert.equal(set.LEAPS[0].score, 88);
});

test("a candidate with no score and no horizonScores produces nothing", () => {
  const cand = { ...fullChainCandidate("NOSCORE", "LONG", 0) };
  delete (cand as { score?: number }).score;
  const set = produceHorizonPlays([cand]);
  assert.equal(totalCommitted(set), 0);
  assert.equal(set.ZERO_DTE.length + set.SWING.length + set.LEAPS.length, 0);
});

test("illiquid chain produces no plays (honesty rule: no contract, no lane)", () => {
  const cand: HorizonCandidate = {
    ticker: "THIN",
    direction: "LONG",
    score: 99,
    asOfYmd: ASOF,
    chainRows: [
      { expiry: "2026-07-23", strike: 100, call_bid: 1, call_ask: 1.1, call_delta: 0.5, call_oi: 5, put_bid: 1, put_ask: 1.1, put_delta: -0.5, put_oi: 5 }, // OI 5 < gate
    ],
  };
  const set = produceHorizonPlays([cand]);
  assert.equal(totalCommitted(set), 0);
  assert.equal(set.ZERO_DTE.length, 0);
});
