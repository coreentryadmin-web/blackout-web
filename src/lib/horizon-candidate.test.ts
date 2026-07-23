import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHorizonCandidate, buildHorizonCandidates, type RawHorizonSignals } from "./horizon-candidate.ts";
import { produceHorizonPlays } from "./horizon-plays.ts";

const ASOF = "2026-07-23";

const CHAIN = [
  { expiry: "2026-07-23", strike: 100, call_bid: 1.0, call_ask: 1.1, call_delta: 0.5, call_oi: 5000, put_bid: 1.0, put_ask: 1.1, put_delta: -0.5, put_oi: 5000 },
  { expiry: "2026-08-06", strike: 108, call_bid: 1.2, call_ask: 1.3, call_delta: 0.34, call_oi: 3000, put_bid: 1.2, put_ask: 1.3, put_delta: -0.34, put_oi: 3000 },
  { expiry: "2026-09-21", strike: 98, call_bid: 6.0, call_ask: 6.3, call_delta: 0.6, call_oi: 1500, put_bid: 6.0, put_ask: 6.3, put_delta: -0.6, put_oi: 1500 },
];

function raw(over: Partial<RawHorizonSignals> = {}): RawHorizonSignals {
  return { ticker: "NVDA", direction: "LONG", asOfYmd: ASOF, chainRows: CHAIN, ...over };
}

test("a name with only live flow is scored for 0DTE and absent from Swing/LEAPS (no fabricated lanes)", () => {
  const c = buildHorizonCandidate(raw({ flowQuality: 88, gammaPull: 0.7, sweepShare: 0.8, intradayAlign: 0.8 }));
  assert.ok(c.horizonScores!.ZERO_DTE! >= 65, "strong flow should commit 0DTE");
  assert.equal(c.horizonScores!.SWING, undefined);
  assert.equal(c.horizonScores!.LEAPS, undefined);
  // ...and produceHorizonPlays therefore emits it ONLY in the 0DTE lane.
  const set = produceHorizonPlays([c]);
  assert.equal(set.ZERO_DTE.length, 1);
  assert.equal(set.SWING.length, 0);
  assert.equal(set.LEAPS.length, 0);
});

test("a durable multi-month name with no live flow is scored for Swing+LEAPS but not 0DTE", () => {
  const c = buildHorizonCandidate(
    raw({
      returnPct10d: 6, spyReturnPct10d: 1, accumAlignedDays: 4, accumTotalDays: 5,
      priceAboveEma20: true, ema20AboveEma50: true, ema50Rising: true,
      hasLongTrendRead: true, priceAboveEma200: true, ema200Rising: true, higherLows: true,
      returnPct63d: 20, spyReturnPct63d: 4, leapsStrikeOi: 3000, leapsStrikeVol: 800, catalyst: 0.6,
    })
  );
  assert.equal(c.horizonScores!.ZERO_DTE, undefined, "no flow read → not a 0DTE candidate");
  assert.ok(c.horizonScores!.SWING! >= 60, "a building move should commit Swing");
  assert.ok(c.horizonScores!.LEAPS! >= 62, "a durable thesis should commit LEAPS");
});

test("the SAME name can COMMIT one lane and only WATCH another (per-lane pick logic)", () => {
  // Hot flow (commits 0DTE) but a weak, choppy multi-day structure (Swing under floor).
  const c = buildHorizonCandidate(
    raw({
      flowQuality: 90, gammaPull: 0.8, sweepShare: 0.8, intradayAlign: 0.9,
      returnPct10d: 1.5, spyReturnPct10d: 1, accumAlignedDays: 1, accumTotalDays: 5,
      priceAboveEma20: false, ema20AboveEma50: false, ema50Rising: false,
    })
  );
  const set = produceHorizonPlays([c]);
  assert.equal(set.ZERO_DTE[0]!.status, "COMMIT");
  assert.equal(set.SWING[0]!.status, "WATCH");
});

test("LEAPS lane is skipped entirely when no long-trend read exists (honest absence)", () => {
  const c = buildHorizonCandidate(raw({ returnPct10d: 5, spyReturnPct10d: 1, hasLongTrendRead: false }));
  assert.equal(c.horizonScores!.LEAPS, undefined);
  assert.ok(c.laneScores.SWING, "swing still evaluated");
  assert.equal(c.laneScores.LEAPS, undefined);
});

test("laneScores carries the component breakdown + reason for the lanes that were evaluated", () => {
  const c = buildHorizonCandidate(raw({ flowQuality: 80, gammaPull: 0.5 }));
  assert.ok(c.laneScores.ZERO_DTE);
  assert.equal(c.laneScores.ZERO_DTE!.horizon, "ZERO_DTE");
  assert.ok(c.laneScores.ZERO_DTE!.reason.includes("flow"));
  assert.ok(c.laneScores.ZERO_DTE!.components.flowQuality > 0);
});

test("buildHorizonCandidates maps a whole pool", () => {
  const pool = buildHorizonCandidates([
    raw({ ticker: "AAA", flowQuality: 90 }),
    raw({ ticker: "BBB", returnPct10d: 5, spyReturnPct10d: 1 }),
  ]);
  assert.equal(pool.length, 2);
  assert.ok(pool[0]!.horizonScores!.ZERO_DTE);
  assert.ok(pool[1]!.horizonScores!.SWING);
});
