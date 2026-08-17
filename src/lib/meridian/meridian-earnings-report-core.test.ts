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
  post_print: null,
  earnings_yoy: { eps_yoy_pct: 20, revenue_yoy_pct: 15 },
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
    earnings_yoy: null,
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
  const report = buildMeridianEarningsReport({ ...baseInput, days_until: 0, earnings_yoy: null });
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
    earnings_yoy: null,
    financials: null,
    analyst_revisions: [],
  });
  assert.equal(report.verdict, "neutral");
});

test("buildMeridianEarningsReport: fresh beat print adds surprise pillar", () => {
  const report = buildMeridianEarningsReport({
    ...baseInput,
    days_until: 0,
    post_print: { lean: "beat", headline: "Beat · EPS +4.2%", score: 2 },
  });
  assert.ok(report.signals.some((s) => s.pillar === "surprise" && s.lean === "bullish"));
});

test("buildMeridianEarningsReport: YoY growth adds yoy pillar", () => {
  const report = buildMeridianEarningsReport({
    ...baseInput,
    earnings_yoy: { eps_yoy_pct: 22, revenue_yoy_pct: 18 },
  });
  assert.ok(report.signals.some((s) => s.pillar === "yoy"));
});
