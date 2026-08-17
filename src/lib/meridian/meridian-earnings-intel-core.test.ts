import { test } from "node:test";
import assert from "node:assert/strict";
import {
  beatArrow,
  beatRateFromPrints,
  buildErPlayRead,
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
