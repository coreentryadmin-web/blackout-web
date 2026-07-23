import { test } from "node:test";
import assert from "node:assert/strict";
import { swingSignalsFromReads, type SwingReads } from "./swing-signals.ts";
import { buildHorizonCandidate } from "./horizon-candidate.ts";
import type { ZeroDteFlowAccumulation } from "./zerodte/flow-accumulation-context.ts";

function accum(over: Partial<ZeroDteFlowAccumulation>): ZeroDteFlowAccumulation {
  return {
    direction: "bull", strength: 70, days: 4, net_signed_premium: 1_000_000,
    magnet_strike: 150, magnet_side: "call", aligned: true, ...over,
  };
}

function reads(over: Partial<SwingReads> = {}): SwingReads {
  return {
    accumulation: accum({}), flowWindowDays: 5,
    returnPct10d: 6, spyReturnPct10d: 1,
    priceAboveEma20: true, ema20AboveEma50: true, ema50Rising: true, ...over,
  };
}

test("neutral / absent accumulation → no swing candidate", () => {
  assert.equal(swingSignalsFromReads(reads({ accumulation: accum({ direction: "neutral" }) })).direction, null);
  assert.equal(swingSignalsFromReads(reads({ accumulation: null })).direction, null);
});

test("a bull accumulation → LONG with raw (up-positive) signed returns and persistence from days/window", () => {
  const s = swingSignalsFromReads(reads({ returnPct10d: 6, spyReturnPct10d: 1 }));
  assert.equal(s.direction, "LONG");
  assert.equal(s.returnPct10d, 6);
  assert.equal(s.spyReturnPct10d, 1);
  assert.equal(s.accumAlignedDays, 4);
  assert.equal(s.accumTotalDays, 5);
  assert.equal(s.priceAboveEma20, true); // bullish stack passes through for a long
});

test("a bear accumulation → SHORT: a DOWN move and UNDERperformance become positive strength", () => {
  // Price fell 6% (returnPct10d -6), SPY rose 1% — a strong SHORT setup.
  const s = swingSignalsFromReads(
    reads({ accumulation: accum({ direction: "bear", days: 3 }), returnPct10d: -6, spyReturnPct10d: 1,
            priceAboveEma20: false, ema20AboveEma50: false, ema50Rising: false }),
  );
  assert.equal(s.direction, "SHORT");
  assert.equal(s.returnPct10d, 6, "a -6% move is +6 aligned magnitude for a short");
  assert.equal(s.spyReturnPct10d, -1, "SPY +1% signs to -1 so rel-strength reads underperformance as strength");
  // The bearish stack (price BELOW ema20, etc.) is the ALIGNED stack for a short → passed as true.
  assert.equal(s.priceAboveEma20, true);
});

test("end-to-end: a short swing scores through the candidate builder (not floored at ~0)", () => {
  const s = swingSignalsFromReads(
    reads({ accumulation: accum({ direction: "bear", days: 5 }), returnPct10d: -7, spyReturnPct10d: 2,
            priceAboveEma20: false, ema20AboveEma50: false, ema50Rising: false }),
  );
  const cand = buildHorizonCandidate({
    ticker: "TSLA", direction: s.direction!, asOfYmd: "2026-07-23", chainRows: [],
    returnPct10d: s.returnPct10d, spyReturnPct10d: s.spyReturnPct10d,
    accumAlignedDays: s.accumAlignedDays, accumTotalDays: s.accumTotalDays,
    priceAboveEma20: s.priceAboveEma20, ema20AboveEma50: s.ema20AboveEma50, ema50Rising: s.ema50Rising,
  });
  assert.equal(cand.direction, "SHORT");
  assert.ok(cand.horizonScores!.SWING! >= 60, `a strong short swing should commit, got ${cand.horizonScores!.SWING}`);
});

test("a LONG and a mirror-image SHORT with equal conviction score the same", () => {
  const long = swingSignalsFromReads(
    reads({ accumulation: accum({ direction: "bull", days: 4 }), returnPct10d: 6, spyReturnPct10d: 1,
            priceAboveEma20: true, ema20AboveEma50: true, ema50Rising: true }),
  );
  const short = swingSignalsFromReads(
    reads({ accumulation: accum({ direction: "bear", days: 4 }), returnPct10d: -6, spyReturnPct10d: -1,
            priceAboveEma20: false, ema20AboveEma50: false, ema50Rising: false }),
  );
  const score = (sig: typeof long) =>
    buildHorizonCandidate({
      ticker: "X", direction: sig.direction!, asOfYmd: "2026-07-23", chainRows: [],
      returnPct10d: sig.returnPct10d, spyReturnPct10d: sig.spyReturnPct10d,
      accumAlignedDays: sig.accumAlignedDays, accumTotalDays: sig.accumTotalDays,
      priceAboveEma20: sig.priceAboveEma20, ema20AboveEma50: sig.ema20AboveEma50, ema50Rising: sig.ema50Rising,
    }).horizonScores!.SWING;
  assert.equal(score(long), score(short));
});
