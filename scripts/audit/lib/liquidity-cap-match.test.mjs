import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isKnownEtfOrIndexProduct,
  looksLikeOrdinaryTickerShape,
  accumulateLiquidityDay,
  finalizeLiquidityMap,
  buildCandidatePool,
  capDollarVolDistance,
  nearestCandidateMatch,
  median,
} from "./liquidity-cap-match.mjs";

test("isKnownEtfOrIndexProduct catches broad-market ETFs, not ordinary stocks", () => {
  assert.equal(isKnownEtfOrIndexProduct("SPY"), true);
  assert.equal(isKnownEtfOrIndexProduct("qqq"), true); // case-insensitive
  assert.equal(isKnownEtfOrIndexProduct("AAPL"), false);
});

test("looksLikeOrdinaryTickerShape accepts 1-5 pure uppercase letters, rejects the rest", () => {
  assert.equal(looksLikeOrdinaryTickerShape("F"), true);
  assert.equal(looksLikeOrdinaryTickerShape("AAPL"), true);
  assert.equal(looksLikeOrdinaryTickerShape("GOOGL"), true);
  assert.equal(looksLikeOrdinaryTickerShape("ABCDEF"), false); // too long
  assert.equal(looksLikeOrdinaryTickerShape("BAC.PRB"), false); // preferred share
  assert.equal(looksLikeOrdinaryTickerShape("ABC.WS"), false); // warrant
  assert.equal(looksLikeOrdinaryTickerShape("abc"), false); // lowercase
  assert.equal(looksLikeOrdinaryTickerShape(""), false);
});

test("accumulateLiquidityDay averages across days and skips malformed rows", () => {
  const acc = new Map();
  accumulateLiquidityDay(acc, [
    { T: "AAA", c: 10, v: 1000 },
    { T: "bbb", c: 0, v: 500 }, // zero close — skipped
    { T: "CCC", c: 5, v: -1 }, // negative volume — skipped
  ]);
  accumulateLiquidityDay(acc, [{ T: "AAA", c: 20, v: 3000 }]);
  const map = finalizeLiquidityMap(acc);
  assert.equal(map.get("AAA").days, 2);
  assert.equal(map.get("AAA").avgPrice, 15); // (10+20)/2
  assert.equal(map.get("AAA").avgDollarVol, (10 * 1000 + 20 * 3000) / 2);
  assert.equal(map.has("BBB"), false);
  assert.equal(map.has("CCC"), false);
});

test("buildCandidatePool excludes earners/ETFs/wrong-shape/thin-liquidity and sorts by $-volume desc", () => {
  const liquidityMap = new Map([
    ["AAA", { avgDollarVol: 100_000_000, avgPrice: 50, days: 10 }], // eligible, richest
    ["BBB", { avgDollarVol: 40_000_000, avgPrice: 30, days: 10 }], // eligible
    ["SPY", { avgDollarVol: 999_000_000, avgPrice: 500, days: 10 }], // ETF — excluded
    ["EARN", { avgDollarVol: 80_000_000, avgPrice: 40, days: 10 }], // in exclude set
    ["THIN", { avgDollarVol: 1_000_000, avgPrice: 20, days: 10 }], // below dollar-vol floor
    ["NEWCO", { avgDollarVol: 90_000_000, avgPrice: 20, days: 2 }], // too few days of data
    ["BAC.PRB", { avgDollarVol: 90_000_000, avgPrice: 20, days: 10 }], // wrong shape
    ["PENNY", { avgDollarVol: 90_000_000, avgPrice: 1, days: 10 }], // below price floor
  ]);
  const pool = buildCandidatePool({
    liquidityMap,
    excludeTickers: new Set(["EARN"]),
    minPrice: 5,
    maxPrice: 2000,
    minDollarVol: 20_000_000,
    minDays: 8,
    poolSize: 10,
  });
  assert.deepEqual(pool.map((r) => r.ticker), ["AAA", "BBB"]);
});

test("buildCandidatePool caps to poolSize, keeping the richest by $-volume", () => {
  const liquidityMap = new Map([
    ["AAA", { avgDollarVol: 300, avgPrice: 10, days: 5 }],
    ["BBB", { avgDollarVol: 200, avgPrice: 10, days: 5 }],
    ["CCC", { avgDollarVol: 100, avgPrice: 10, days: 5 }],
  ]);
  const pool = buildCandidatePool({
    liquidityMap,
    excludeTickers: new Set(),
    minPrice: 1,
    maxPrice: 2000,
    minDollarVol: 1,
    minDays: 1,
    poolSize: 2,
  });
  assert.deepEqual(pool.map((r) => r.ticker), ["AAA", "BBB"]);
});

test("capDollarVolDistance is zero at equality and symmetric under ratio inversion", () => {
  const a = { cap: 100, dvol: 100 };
  const b = { cap: 100, dvol: 100 };
  assert.equal(capDollarVolDistance(a, b), 0);

  const target = { cap: 200, dvol: 50 };
  const candA = { cap: 100, dvol: 50 }; // cap 2x candidate
  const candB = { cap: 400, dvol: 50 }; // cap 0.5x candidate (same ratio magnitude, inverted)
  assert.ok(Math.abs(capDollarVolDistance(target, candA) - capDollarVolDistance(target, candB)) < 1e-9);
});

test("capDollarVolDistance is Infinity on any missing/non-positive side", () => {
  assert.equal(capDollarVolDistance({ cap: 0, dvol: 10 }, { cap: 10, dvol: 10 }), Infinity);
  assert.equal(capDollarVolDistance({ cap: 10, dvol: 10 }, { cap: 10, dvol: -5 }), Infinity);
  assert.equal(capDollarVolDistance(null, { cap: 10, dvol: 10 }), Infinity);
});

test("nearestCandidateMatch picks the true minimum distance, not just the first close one", () => {
  const target = { cap: 1000, dvol: 1000 };
  const candidates = [
    { ticker: "FAR", cap: 100, dvol: 1000 },
    { ticker: "CLOSE", cap: 1100, dvol: 950 },
    { ticker: "MID", cap: 500, dvol: 1000 },
  ];
  const match = nearestCandidateMatch(target, candidates);
  assert.equal(match.ticker, "CLOSE");
  assert.ok(match.distance < capDollarVolDistance(target, { cap: 500, dvol: 1000 }));
});

test("nearestCandidateMatch excludes the target's own ticker if present, returns null on empty pool", () => {
  const target = { cap: 100, dvol: 100 };
  const candidates = [{ ticker: "SELF", cap: 100, dvol: 100 }, { ticker: "OTHER", cap: 90, dvol: 90 }];
  const match = nearestCandidateMatch(target, candidates, "SELF");
  assert.equal(match.ticker, "OTHER");
  assert.equal(nearestCandidateMatch(target, [], "SELF"), null);
});

test("median: standard odd/even, ignores non-finite, null on empty", () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([1, NaN, 3, undefined, Infinity]), 2);
  assert.equal(median([]), null);
  assert.equal(median(), null);
});
