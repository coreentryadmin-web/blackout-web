import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMeridianMacroReport } from "./meridian-macro-report-core";

const baseRail = {
  sample_size: 4,
  avg_spx_session_pct: -0.45,
  avg_spx_next_day_pct: -0.1,
  avg_intraday_60_pct: -0.62,
  regime_tag: "risk_off" as const,
  headline: "Last 4 CPI prints: avg SPX -0.45% session",
};

const baseInput = {
  event: "CPI",
  date: "2026-08-20",
  time: "08:30",
  impact: "high" as const,
  estimate: "3.2%",
  days_until: 3,
  correlation_rail: baseRail,
  surprise: {
    actual: null,
    estimate: 3.2,
    surprise_pct: null,
    verdict: "unknown" as const,
    historical: { beats: 2, misses: 2, avg_surprise_pct: 0.1 },
  },
  related_headlines: [{ title: "CPI preview: inflation sticky", channel: "economics", published: null }],
  spx_positioning: {
    available: true,
    spot: 5500,
    flip: 5480,
    flip_distance_pts: 20,
    call_wall: 5550,
    put_wall: 5450,
    net_gex_label: "$1.2M",
    gamma_regime: "short gamma vol expansion",
  },
  flow: {
    available: true,
    bias: "bearish" as const,
    summary: "Put premium dominates",
    call_put_ratio: 0.72,
    net_premium: -500_000,
  },
};

test("buildMeridianMacroReport: historical expected move from 60m avg", () => {
  const report = buildMeridianMacroReport(baseInput);
  assert.equal(report.expected_move.available, true);
  assert.equal(report.expected_move.intraday_60_pct, -0.62);
  assert.match(report.expected_move.headline ?? "", /60m/);
});

test("buildMeridianMacroReport: risk-off outlook with warnings", () => {
  const report = buildMeridianMacroReport(baseInput);
  assert.equal(report.outlook.lean, "risk_off");
  assert.ok(report.warnings.some((w) => /High-impact/.test(w)));
  assert.ok(report.watch_list.some((w) => /Consensus/.test(w)));
});

test("buildMeridianMacroReport: CPI scenarios include core/headline note", () => {
  const report = buildMeridianMacroReport(baseInput);
  assert.ok(report.scenarios.some((s) => /Core vs headline/.test(s)));
});

test("buildMeridianMacroReport: news context from headlines", () => {
  const report = buildMeridianMacroReport(baseInput);
  assert.equal(report.news_context.length, 1);
  assert.match(report.news_context[0], /CPI preview/);
});
