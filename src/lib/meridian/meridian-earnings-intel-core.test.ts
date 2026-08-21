import { test } from "node:test";
import assert from "node:assert/strict";
import {
  beatArrow,
  beatRateFromPrints,
  buildErPlayRead,
  beatRateWithCohort,
  coerceMeridianWallLevels,
  flowWindowHours,
  moveArrow,
  shapeMeridianDarkPool,
} from "./meridian-earnings-intel-core";
import { buildMeridianFinancialsContext } from "./meridian-financials-context";

test("flowWindowHours scales with days until print", () => {
  assert.equal(flowWindowHours(null), 72);
  assert.equal(flowWindowHours(0), 24);
  assert.equal(flowWindowHours(1), 48);
  assert.equal(flowWindowHours(3), 72);
  assert.equal(flowWindowHours(14), 168);
});

test("beatArrow and moveArrow", () => {
  assert.equal(beatArrow(true), "↑");
  assert.equal(beatArrow(false), "↓");
  assert.equal(beatArrow(null), null);
  assert.equal(moveArrow(1.2), "↑");
  assert.equal(moveArrow(-0.5), "↓");
  assert.equal(moveArrow(0.1), "→");
});

test("beatRateFromPrints", () => {
  const rate = beatRateFromPrints([
    { report_date: "2026-01-01", eps_estimate: 1, eps_actual: 1.1, surprise_pct: 10, beat: true, expected_move_pct: 8, session_change_pct: 2, next_day_change_pct: null },
    { report_date: "2025-10-01", eps_estimate: 1, eps_actual: 0.9, surprise_pct: -10, beat: false, expected_move_pct: 7, session_change_pct: -3, next_day_change_pct: null },
  ]);
  assert.equal(rate, 0.5);
});

test("buildErPlayRead: imminent print favors avoid_directional", () => {
  const read = buildErPlayRead({
    flow_bias: "bullish",
    gamma_regime: "positive gamma",
    expected_move_pct: 8,
    days_until: 0,
    beat_rate: 0.8,
    spot: 100,
    call_wall: 105,
    put_wall: 95,
    king_strike: 100,
  });
  assert.equal(read.lean, "avoid_directional");
  assert.equal(read.confidence, "low");
  assert.match(read.headline, /Imminent/);
});

test("buildErPlayRead: bullish lean when flow + beat rate align", () => {
  const read = buildErPlayRead({
    flow_bias: "bullish",
    gamma_regime: "positive gamma support",
    expected_move_pct: 6,
    days_until: 5,
    beat_rate: 0.75,
    spot: 500,
    call_wall: 520,
    put_wall: 480,
    king_strike: 500,
  });
  assert.equal(read.lean, "bullish");
  assert.ok(read.rationale.length >= 2);
});

test("buildErPlayRead: dark pool bias nudges lean", () => {
  const read = buildErPlayRead({
    flow_bias: "neutral",
    dark_pool_bias: "bullish",
    gamma_regime: "positive gamma",
    expected_move_pct: 6,
    days_until: 5,
    beat_rate: 0.75,
    spot: 500,
    call_wall: 520,
    put_wall: 480,
    king_strike: 500,
  });
  assert.equal(read.lean, "bullish");
  assert.ok(read.rationale.some((r) => /Dark pool/.test(r)));
});

test("shapeMeridianDarkPool maps snapshot prints", () => {
  const shaped = shapeMeridianDarkPool({
    prints: [
      { strike: 180, premium: 2_500_000, side: "buy", executed_at: "2026-08-17T14:30:00" },
      { strike: 175, premium: 1_200_000, side: "sell", executed_at: "2026-08-17T15:00:00" },
    ],
    total_premium: 3_700_000,
    call_premium: 2_500_000,
    put_premium: 1_200_000,
    bias: "bullish",
    pcr: 0.48,
    detail: "2 print(s) | $3.70M",
  });
  assert.equal(shaped.available, true);
  assert.equal(shaped.top_prints.length, 2);
  assert.equal(shaped.total_premium_label, "$3.7M");
  assert.equal(shaped.top_prints[0].executed_at, "14:30");
});

test("shapeMeridianDarkPool: empty snapshot", () => {
  const shaped = shapeMeridianDarkPool({
    prints: [],
    total_premium: 0,
    call_premium: 0,
    put_premium: 0,
    bias: "neutral",
    pcr: null,
    detail: "No prints today",
  });
  assert.equal(shaped.available, false);
});

test("shapeMeridianDarkPool: aggregate premium without tape rows", () => {
  const shaped = shapeMeridianDarkPool({
    prints: [],
    total_premium: 1_500_000,
    call_premium: 900_000,
    put_premium: 600_000,
    bias: "bullish",
    pcr: 0.67,
    detail: null,
  });
  assert.equal(shaped.available, true);
  assert.equal(shaped.top_prints.length, 0);
  assert.equal(shaped.total_premium_label, "$1.5M");
  assert.match(String(shaped.detail), /tape unavailable/i);
});

test("coerceMeridianWallLevels preserves gamma truth and orders display band when inverted", () => {
  const tgt = coerceMeridianWallLevels({ call_wall: 150, put_wall: 152.5, spot: 151.01 });
  assert.equal(tgt.gamma_call_wall, 150);
  assert.equal(tgt.gamma_put_wall, 152.5);
  assert.equal(tgt.walls_inverted, true);
  assert.equal(tgt.put_wall, 150);
  assert.equal(tgt.call_wall, 152.5);

  const normal = coerceMeridianWallLevels({ call_wall: 520, put_wall: 480, spot: 500 });
  assert.equal(normal.walls_inverted, false);
  assert.equal(normal.call_wall, 520);
  assert.equal(normal.put_wall, 480);
});

test("coerceMeridianWallLevels uses spot to split a pinned single strike", () => {
  const pinned = coerceMeridianWallLevels({ call_wall: 7.5, put_wall: 7.5, spot: 8.2 });
  assert.ok((pinned.call_wall ?? 0) > (pinned.put_wall ?? 0));
  assert.equal(pinned.gamma_call_wall, 7.5);
});

test("buildMeridianFinancialsContext maps fundamentals bundle", () => {
  const ctx = buildMeridianFinancialsContext({
    as_of: "2026-08-01",
    ratios: { pe_ratio: 28.5, price_to_sales: 12.1, roe: 0.42 },
    signals: {
      revenue_yoy_pct: 18,
      net_margin_pct: 22,
      margin_trend: "expanding",
      fcf_positive: true,
      fcf_trend: "rising",
      eps_trajectory: "up",
      net_cash_positive: true,
    },
    price_target: { price_target: 550, upside_pct: 12.5 },
  } as Parameters<typeof buildMeridianFinancialsContext>[0]);
  assert.ok(ctx?.available);
  assert.match(ctx?.headline ?? "", /P\/E 28\.5/);
  assert.match(ctx?.headline ?? "", /Rev \+18% YoY/);
  assert.equal(ctx?.price_target, 550);
});

test("the play-read rationale states the beat rate's COHORT, not just the rate", () => {
  // "Historical beat rate 100% over recent prints" is a string this surface really produces off
  // a sample of ONE — measured live, 10.2% of names that get a beat rate at all get it from one
  // or two graded prints, and 1.0 clears the 0.65 bullish threshold outright. The rate is not
  // the problem; the rate arriving without a denominator is.
  const base = {
    flow_bias: "bullish" as const,
    gamma_regime: "positive gamma support",
    expected_move_pct: 6,
    days_until: 5,
    spot: 100,
    call_wall: 105,
    put_wall: 95,
    king_strike: 100,
  };

  const thin = buildErPlayRead({ ...base, beat_rate: 1, beat_rate_graded: 1 });
  assert.ok(
    thin.rationale.some((r) => /beat rate 100% over 1 print\b/.test(r)),
    `expected a singular one-print cohort, got: ${JSON.stringify(thin.rationale)}`
  );

  const thick = buildErPlayRead({ ...base, beat_rate: 1, beat_rate_graded: 8 });
  assert.ok(
    thick.rationale.some((r) => /beat rate 100% over 8 prints/.test(r)),
    `expected an eight-print cohort, got: ${JSON.stringify(thick.rationale)}`
  );

  // The MISS branch carries it too — a 0% beat rate off one print is the same defect mirrored.
  const missy = buildErPlayRead({ ...base, flow_bias: "bearish", beat_rate: 0, beat_rate_graded: 2 });
  assert.ok(
    missy.rationale.some((r) => /0% beat rate over 2 prints/.test(r)),
    `expected the miss branch to carry its cohort, got: ${JSON.stringify(missy.rationale)}`
  );
});

test("an UNKNOWN cohort says nothing rather than inventing one", () => {
  // A caller that hands over a rate with no count is not told "over 0 prints" beside a real
  // percentage — a fabricated denominator reads as a measurement. The suffix is simply absent.
  const read = buildErPlayRead({
    flow_bias: "bullish",
    gamma_regime: "positive gamma support",
    expected_move_pct: 6,
    days_until: 5,
    beat_rate: 0.9,
    spot: 100,
    call_wall: 105,
    put_wall: 95,
    king_strike: 100,
  });
  const line = read.rationale.find((r) => /beat rate/.test(r));
  assert.ok(line, "the rate should still be reported");
  assert.doesNotMatch(line!, /over 0 print/);
  assert.doesNotMatch(line!, /NaN|undefined|null/);
});

test("beatRateWithCohort: the rate and its denominator, or null and zero", () => {
  const some = beatRateWithCohort([
    { report_date: "2026-05-01", beat: true } as never,
    { report_date: "2026-02-01", beat: false } as never,
    { report_date: "2025-11-01", beat: null } as never,
  ]);
  assert.equal(some.rate, 0.5);
  assert.equal(some.graded, 2, "the ungraded print is excluded from BOTH halves");

  const none = beatRateWithCohort([{ report_date: "2026-05-01", beat: null } as never]);
  assert.equal(none.rate, null);
  assert.equal(none.graded, 0);
});

/* ── "into earnings" is forward-looking too ──────────────────────────────────────────── */

test("buildErPlayRead: a printed name is never described as leaning INTO earnings", () => {
  // #2591 stopped this function saying "Imminent print — favor reaction over prediction" once a
  // name had reported. Validating that PR on production showed the fix was half-done: BEKE, BJ
  // and BKE had all reported before the open, and with the imminent branch correctly suppressed
  // they fell straight through to
  //
  //   "Flow + structure lean bullish INTO earnings"
  //
  // about a print six hours in the past. The report core had its "into earnings" phrasings guarded
  // in the same PR; this one was missed. Same defect, one branch over.
  const printed = buildErPlayRead({
    flow_bias: "bullish",
    dark_pool_bias: "bullish",
    gamma_regime: "positive gamma",
    expected_move_pct: 3,
    days_until: 0,
    beat_rate: 0.8,
    beat_rate_graded: 8,
    spot: 100,
    call_wall: 105,
    put_wall: 95,
    king_strike: 100,
    printed: true,
  });
  assert.doesNotMatch(printed.headline, /imminent/i, "the print already happened");
  assert.doesNotMatch(
    printed.headline,
    /into earnings/i,
    "a lean cannot point INTO an event that has already occurred"
  );
  assert.match(printed.headline, /since the print/i, "it should describe what has happened since");
});

test("buildErPlayRead: an upcoming print still leans INTO earnings", () => {
  // The guard must not swallow the case the phrasing exists for.
  const upcoming = buildErPlayRead({
    flow_bias: "bullish",
    dark_pool_bias: "bullish",
    gamma_regime: "positive gamma",
    expected_move_pct: 3,
    days_until: 4,
    beat_rate: 0.8,
    beat_rate_graded: 8,
    spot: 100,
    call_wall: 105,
    put_wall: 95,
    king_strike: 100,
  });
  assert.match(upcoming.headline, /into earnings/i);
  assert.doesNotMatch(upcoming.headline, /since the print/i);
});
