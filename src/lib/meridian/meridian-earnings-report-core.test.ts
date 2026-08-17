import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMeridianEarningsReport } from "./meridian-earnings-report-core";

const baseInput = {
  ticker: "NVDA",
  days_until: 5,
  flow_bias: "bullish",
  dark_pool_bias: "bullish",
  dark_pool_available: true,
  gamma_regime: "positive gamma support",
  thermal_available: true,
  spot: 500,
  king_strike: 495,
  call_wall: 520,
  put_wall: 480,
  expected_move_pct: 8,
  beat_rate: 0.75,
  financials: {
    available: true,
    as_of: "2026-08-01",
    headline: "P/E 28 · Rev +18% YoY",
    pe_ratio: 28,
    price_to_sales: 12,
    roe_pct: 42,
    revenue_yoy_pct: 18,
    net_margin_pct: 22,
    margin_trend: "expanding" as const,
    fcf_positive: true,
    fcf_trend: "rising" as const,
    eps_trajectory: "rising",
    net_cash_positive: true,
    price_target: 550,
    price_target_upside_pct: null,
  },
  analyst_revisions: [{ title: "Goldman: Raises PT", action: "upgrade" }],
  earnings_headlines: [{ title: "NVDA preview", channel: "earnings", published: null }],
  catalysts: [],
  insider_activity_count: 0,
  vector_move_pct: 7.5,
  vector_expiry: "2026-08-22",
};

test("buildMeridianEarningsReport: aligned pillars → bullish", () => {
  const report = buildMeridianEarningsReport(baseInput);
  assert.equal(report.verdict, "bullish");
  assert.ok(report.score >= 3);
  assert.ok(report.signals.some((s) => s.pillar === "flow"));
  assert.match(report.headline, /bullish/i);
});

test("buildMeridianEarningsReport: bearish flow flips lean", () => {
  const report = buildMeridianEarningsReport({
    ...baseInput,
    flow_bias: "bearish",
    dark_pool_bias: "bearish",
    beat_rate: 0.25,
    financials: {
      ...baseInput.financials!,
      revenue_yoy_pct: -5,
      margin_trend: "contracting",
    },
  });
  assert.equal(report.verdict, "bearish");
  assert.ok(report.score <= -3);
});

test("buildMeridianEarningsReport: imminent print stays neutral verdict", () => {
  const report = buildMeridianEarningsReport({ ...baseInput, days_until: 0 });
  assert.equal(report.verdict, "neutral");
  assert.equal(report.confidence, "low");
  assert.match(report.best_play.headline, /Wait for the print/i);
});

test("buildMeridianEarningsReport: mixed signals → neutral", () => {
  const report = buildMeridianEarningsReport({
    ...baseInput,
    flow_bias: "neutral",
    dark_pool_available: false,
    beat_rate: 0.5,
    financials: null,
    analyst_revisions: [],
  });
  assert.equal(report.verdict, "neutral");
});
