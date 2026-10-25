import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMomentumSignal, type MomentumSignalChainRow } from "./momentum-signal.ts";
import { RVOL_HIGH } from "./relative-volume.ts";
import type { MomentumBar } from "./momentum-acceleration.ts";

function makeBars(prices: number[]): MomentumBar[] {
  return prices.map((c, i) => ({ t: i, h: c, l: c, c }));
}

// Prior window (bars 0-4): 100 -> 100.04 (+0.04%). Recent window (bars 5-9): 100.04 -> 100.8
// (+0.76%) — same sign, bigger magnitude, clears the 0.05% noise floor -> accelerating up.
const UP_BARS = makeBars([100, 100.01, 100.02, 100.03, 100.04, 100.04, 100.1, 100.2, 100.4, 100.8]);
const UP_REFERENCE = { high: 100.5, low: 99 }; // last close 100.8 breaks above -> confirmed "up"

// Mirror image, confirmed "down".
const DOWN_BARS = makeBars([100, 99.99, 99.98, 99.97, 99.96, 99.96, 99.9, 99.8, 99.6, 99.2]);
const DOWN_REFERENCE = { high: 101, low: 99.5 }; // last close 99.2 breaks below -> confirmed "down"

function chainRow(overrides: Partial<MomentumSignalChainRow> = {}): MomentumSignalChainRow {
  return { strike: 101, side: "call", bid: 0.5, ask: 0.6, oi: 500, iv: 0.4, ...overrides };
}

test("evaluateMomentumSignal: not detected when momentum confirms but RVOL is below the floor", () => {
  const r = evaluateMomentumSignal({
    ticker: "AAPL",
    bars: UP_BARS,
    referenceLevel: UP_REFERENCE,
    rvolRatio: 1.0,
    minutesRemaining: 120,
    chain: [chainRow()],
  });
  assert.equal(r.detected, false);
  assert.equal(r.direction, null);
  assert.deepEqual(r.candidates, []);
  assert.deepEqual(r.rejections, [], "no chain screening happens without a detected setup");
  assert.equal(r.rvol_floor_used, RVOL_HIGH, "defaults to the shared RVOL_HIGH constant");
});

test("evaluateMomentumSignal: not detected when RVOL clears the floor but momentum never confirms (no reference level)", () => {
  const r = evaluateMomentumSignal({
    ticker: "AAPL",
    bars: UP_BARS,
    referenceLevel: null,
    rvolRatio: 3.0,
    minutesRemaining: 120,
    chain: [chainRow()],
  });
  assert.equal(r.momentum.accelerating, true, "the underlying move itself still reads as accelerating");
  assert.equal(r.momentum.confirmed, false, "no key-level break was supplied to confirm it");
  assert.equal(r.detected, false);
  assert.deepEqual(r.candidates, []);
  assert.deepEqual(r.rejections, []);
});

test("evaluateMomentumSignal: detected=true, direction=long, for a confirmed up-move with RVOL clearing the floor", () => {
  const r = evaluateMomentumSignal({
    ticker: "AAPL",
    bars: UP_BARS,
    referenceLevel: UP_REFERENCE,
    rvolRatio: 2.0,
    minutesRemaining: 120,
    chain: [chainRow()],
  });
  assert.equal(r.detected, true);
  assert.equal(r.direction, "long");
  assert.equal(r.momentum.direction, "up");
});

test("evaluateMomentumSignal: detected=true, direction=short, for a confirmed down-move, and only puts survive the chain filter", () => {
  const r = evaluateMomentumSignal({
    ticker: "AAPL",
    bars: DOWN_BARS,
    referenceLevel: DOWN_REFERENCE,
    rvolRatio: 2.0,
    minutesRemaining: 120,
    chain: [
      chainRow({ strike: 99, side: "put", bid: 0.4, ask: 0.5 }),
      chainRow({ strike: 101, side: "call", bid: 0.5, ask: 0.6 }), // wrong side for a short -> silently excluded
    ],
  });
  assert.equal(r.detected, true);
  assert.equal(r.direction, "short");
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0]!.side, "put");
  assert.deepEqual(r.rejections, [], "the wrong-side call is excluded by the reachability filter, not rejected");
});

test("evaluateMomentumSignal: hard-rejects a contract with no ask at all (ask_missing_or_invalid)", () => {
  const r = evaluateMomentumSignal({
    ticker: "AAPL",
    bars: UP_BARS,
    referenceLevel: UP_REFERENCE,
    rvolRatio: 2.0,
    minutesRemaining: 120,
    chain: [chainRow({ ask: null })],
  });
  assert.equal(r.candidates.length, 0);
  assert.equal(r.rejections.length, 1);
  assert.equal(r.rejections[0]!.reject_reason, "ask_missing_or_invalid");
});

test("evaluateMomentumSignal: hard-rejects a contract with ask <= 0 (ask_missing_or_invalid)", () => {
  const r = evaluateMomentumSignal({
    ticker: "AAPL",
    bars: UP_BARS,
    referenceLevel: UP_REFERENCE,
    rvolRatio: 2.0,
    minutesRemaining: 120,
    chain: [chainRow({ ask: 0 })],
  });
  assert.equal(r.candidates.length, 0);
  assert.equal(r.rejections[0]!.reject_reason, "ask_missing_or_invalid");
});

test("evaluateMomentumSignal: hard-rejects a one-sided quote with no real bid (stale_quote_no_two_sided_market)", () => {
  const r = evaluateMomentumSignal({
    ticker: "AAPL",
    bars: UP_BARS,
    referenceLevel: UP_REFERENCE,
    rvolRatio: 2.0,
    minutesRemaining: 120,
    chain: [chainRow({ bid: null, ask: 0.5 })],
  });
  assert.equal(r.candidates.length, 0);
  assert.equal(r.rejections[0]!.reject_reason, "stale_quote_no_two_sided_market");
});

test("evaluateMomentumSignal: hard-rejects an ask at/above the price band (ask_above_price_band), default $1.00", () => {
  const r = evaluateMomentumSignal({
    ticker: "AAPL",
    bars: UP_BARS,
    referenceLevel: UP_REFERENCE,
    rvolRatio: 2.0,
    minutesRemaining: 120,
    chain: [chainRow({ bid: 0.95, ask: 1.0 }), chainRow({ strike: 102, bid: 1.4, ask: 1.5 })],
  });
  assert.equal(r.candidates.length, 0);
  assert.equal(r.rejections.length, 2);
  for (const rej of r.rejections) assert.equal(rej.reject_reason, "ask_above_price_band");
});

test("evaluateMomentumSignal: a caller-overridden maxAsk widens or narrows the price band", () => {
  const r = evaluateMomentumSignal({
    ticker: "AAPL",
    bars: UP_BARS,
    referenceLevel: UP_REFERENCE,
    rvolRatio: 2.0,
    minutesRemaining: 120,
    chain: [chainRow({ bid: 1.4, ask: 1.5 })],
    maxAsk: 2.0,
  });
  assert.equal(r.candidates.length, 1, "ask $1.50 survives under a $2.00 band");
  assert.equal(r.rejections.length, 0);
});

test("evaluateMomentumSignal: hard-rejects a quote older than staleQuoteMaxAgeMs (stale_quote_age)", () => {
  const nowMs = 1_700_000_000_000;
  const r = evaluateMomentumSignal({
    ticker: "AAPL",
    bars: UP_BARS,
    referenceLevel: UP_REFERENCE,
    rvolRatio: 2.0,
    minutesRemaining: 120,
    chain: [chainRow({ quoteAsOfMs: nowMs - 10 * 60_000 })],
    nowMs,
  });
  assert.equal(r.candidates.length, 0);
  assert.equal(r.rejections[0]!.reject_reason, "stale_quote_age");
});

test("evaluateMomentumSignal: a quote within staleQuoteMaxAgeMs is NOT rejected for staleness", () => {
  const nowMs = 1_700_000_000_000;
  const r = evaluateMomentumSignal({
    ticker: "AAPL",
    bars: UP_BARS,
    referenceLevel: UP_REFERENCE,
    rvolRatio: 2.0,
    minutesRemaining: 120,
    chain: [chainRow({ quoteAsOfMs: nowMs - 60_000 })],
    nowMs,
  });
  assert.equal(r.candidates.length, 1);
  assert.equal(r.rejections.length, 0);
});

test("evaluateMomentumSignal: no nowMs supplied never triggers the staleness check even with a quoteAsOfMs present", () => {
  const r = evaluateMomentumSignal({
    ticker: "AAPL",
    bars: UP_BARS,
    referenceLevel: UP_REFERENCE,
    rvolRatio: 2.0,
    minutesRemaining: 120,
    chain: [chainRow({ quoteAsOfMs: 1 })], // absurdly old epoch ms, but nowMs is never supplied
  });
  assert.equal(r.candidates.length, 1);
  assert.equal(r.rejections.length, 0);
});

test("evaluateMomentumSignal: hard-rejects an illiquid survivor below the caller's minOi floor (illiquid)", () => {
  const r = evaluateMomentumSignal({
    ticker: "AAPL",
    bars: UP_BARS,
    referenceLevel: UP_REFERENCE,
    rvolRatio: 2.0,
    minutesRemaining: 120,
    chain: [chainRow({ oi: 1 })],
    minOi: 50,
  });
  assert.equal(r.candidates.length, 0);
  assert.equal(r.rejections.length, 1);
  assert.equal(r.rejections[0]!.reject_reason, "illiquid");
});

test("evaluateMomentumSignal: a surviving candidate carries honest reachability/target fields and the ask as cost basis", () => {
  const r = evaluateMomentumSignal({
    ticker: "AAPL",
    bars: UP_BARS,
    referenceLevel: UP_REFERENCE,
    rvolRatio: 2.0,
    minutesRemaining: 120,
    chain: [chainRow({ strike: 101, bid: 0.5, ask: 0.6, oi: 500, iv: 0.4 })],
    targetPremium: 20,
  });
  assert.equal(r.candidates.length, 1);
  const c = r.candidates[0]!;
  assert.equal(c.ticker, "AAPL");
  assert.equal(c.direction, "long");
  assert.equal(c.strike, 101);
  assert.equal(c.side, "call");
  assert.equal(c.ask, 0.6, "cost basis (the ask) is reported honestly");
  assert.equal(c.target_premium, 20);
  assert.equal(c.required_underlying_price, 121, "strike (101) + target premium (20)");
  assert.ok(c.reachability_prob != null);
  assert.ok(c.target_reachability_prob != null);
});

test("evaluateMomentumSignal: candidates are ranked by rank_score descending (closer target first, same spread)", () => {
  const r = evaluateMomentumSignal({
    ticker: "AAPL",
    bars: UP_BARS,
    referenceLevel: UP_REFERENCE,
    rvolRatio: 2.0,
    minutesRemaining: 120,
    chain: [
      chainRow({ strike: 150, bid: 0.5, ask: 0.6, oi: 500, iv: 0.4 }), // far from a $20 target
      chainRow({ strike: 105, bid: 0.5, ask: 0.6, oi: 500, iv: 0.4 }), // much closer to a $20 target
    ],
    targetPremium: 20,
  });
  assert.equal(r.candidates.length, 2);
  assert.equal(r.candidates[0]!.strike, 105, "the strike closer to the premium target should rank first");
  assert.ok(r.candidates[0]!.rank_score >= r.candidates[1]!.rank_score);
});

test("evaluateMomentumSignal: a missing iv still produces a candidate (target reachability fields null, never fabricated)", () => {
  const r = evaluateMomentumSignal({
    ticker: "AAPL",
    bars: UP_BARS,
    referenceLevel: UP_REFERENCE,
    rvolRatio: 2.0,
    minutesRemaining: 120,
    chain: [chainRow({ iv: null })],
  });
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0]!.target_reachability_prob, null);
  assert.equal(r.candidates[0]!.reachability_prob, null);
});

test("evaluateMomentumSignal: rejections and candidates both report honestly when the chain mixes good and bad rows", () => {
  const r = evaluateMomentumSignal({
    ticker: "AAPL",
    bars: UP_BARS,
    referenceLevel: UP_REFERENCE,
    rvolRatio: 2.0,
    minutesRemaining: 120,
    chain: [
      chainRow({ strike: 101, bid: 0.5, ask: 0.6 }), // survives
      chainRow({ strike: 102, ask: null }), // ask_missing_or_invalid
      chainRow({ strike: 103, bid: 0.9, ask: 1.0 }), // ask_above_price_band
    ],
  });
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0]!.strike, 101);
  assert.equal(r.rejections.length, 2);
  const reasons = r.rejections.map((x) => x.reject_reason).sort();
  assert.deepEqual(reasons, ["ask_above_price_band", "ask_missing_or_invalid"]);
});
