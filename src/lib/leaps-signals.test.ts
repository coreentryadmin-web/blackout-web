import { test } from "node:test";
import assert from "node:assert/strict";
import { leapsSignalsFromReads, type LeapsReads } from "./leaps-signals.ts";
import { buildHorizonCandidate } from "./horizon-candidate.ts";

function reads(over: Partial<LeapsReads> = {}): LeapsReads {
  return {
    structureLean: "bull",
    priceAboveEma200: true, ema200Rising: true, higherLows: true,
    returnPct63d: 20, spyReturnPct63d: 4,
    leapsStrikeOi: 3000, leapsStrikeVol: 800, catalyst: 0.6, ...over,
  };
}

test("neutral structure → no LEAPS candidate", () => {
  const s = leapsSignalsFromReads(reads({ structureLean: "neutral" }));
  assert.equal(s.direction, null);
  assert.equal(s.hasLongTrendRead, false);
});

test("bull structure → LONG with raw-positive 63d returns and bullish durability passed through", () => {
  const s = leapsSignalsFromReads(reads({ returnPct63d: 20, spyReturnPct63d: 4 }));
  assert.equal(s.direction, "LONG");
  assert.equal(s.hasLongTrendRead, true);
  assert.equal(s.returnPct63d, 20);
  assert.equal(s.priceAboveEma200, true);
});

test("bear structure → SHORT: a 3-month decline and underperformance become positive durable strength", () => {
  // Below a falling 200-day, lower highs; name fell 18% over 3mo while SPY rose 4%.
  const s = leapsSignalsFromReads(
    reads({ structureLean: "bear", priceAboveEma200: false, ema200Rising: false, higherLows: false,
            returnPct63d: -18, spyReturnPct63d: 4 }),
  );
  assert.equal(s.direction, "SHORT");
  assert.equal(s.returnPct63d, 18, "a -18% 3mo move is +18 aligned magnitude for a short");
  assert.equal(s.spyReturnPct63d, -4);
  assert.equal(s.priceAboveEma200, true, "the bearish structure (below 200) is the ALIGNED durable read");
});

test("end-to-end: a durable SHORT LEAPS commits through the candidate builder", () => {
  const s = leapsSignalsFromReads(
    reads({ structureLean: "bear", priceAboveEma200: false, ema200Rising: false, higherLows: false,
            returnPct63d: -22, spyReturnPct63d: 3, leapsStrikeOi: 4000, leapsStrikeVol: 900, catalyst: 0.7 }),
  );
  const cand = buildHorizonCandidate({
    ticker: "XYZ", direction: s.direction!, asOfYmd: "2026-07-23", chainRows: [],
    hasLongTrendRead: s.hasLongTrendRead,
    priceAboveEma200: s.priceAboveEma200, ema200Rising: s.ema200Rising, higherLows: s.higherLows,
    returnPct63d: s.returnPct63d, spyReturnPct63d: s.spyReturnPct63d,
    leapsStrikeOi: s.leapsStrikeOi, leapsStrikeVol: s.leapsStrikeVol, catalyst: s.catalyst,
  });
  assert.equal(cand.direction, "SHORT");
  assert.ok(cand.horizonScores!.LEAPS! >= 62, `a durable short LEAPS should commit, got ${cand.horizonScores!.LEAPS}`);
});

test("no durable structure → the LEAPS lane stays honestly empty even with strong RS + liquidity", () => {
  const s = leapsSignalsFromReads(reads({ structureLean: "neutral", returnPct63d: 40, leapsStrikeOi: 9000 }));
  const cand = buildHorizonCandidate({
    ticker: "Q", direction: "LONG", asOfYmd: "2026-07-23", chainRows: [],
    hasLongTrendRead: s.hasLongTrendRead,
    returnPct63d: s.returnPct63d, spyReturnPct63d: s.spyReturnPct63d, leapsStrikeOi: s.leapsStrikeOi,
  });
  assert.equal(cand.horizonScores!.LEAPS, undefined, "no durable trend → not a LEAPS candidate, however hot the flow");
});
