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
  now_et_minutes: null,
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

// FINDINGS: days_until alone is day-granularity ("today" from 00:00 to 23:59 ET), so a print
// released hours ago kept warning "live or imminent" all evening. now_et_minutes lets the check
// compare against the release's own clock time instead.
test("buildMeridianMacroReport: 'live or imminent' warning shows before the release today", () => {
  const report = buildMeridianMacroReport({
    ...baseInput,
    time: "08:30",
    days_until: 0,
    now_et_minutes: 8 * 60, // 08:00 ET — before the 08:30 release
  });
  assert.ok(report.warnings.some((w) => /live or imminent/.test(w)));
});

test("buildMeridianMacroReport: 'live or imminent' warning still shows shortly after the release today", () => {
  const report = buildMeridianMacroReport({
    ...baseInput,
    time: "08:30",
    days_until: 0,
    now_et_minutes: 9 * 60, // 09:00 ET — 30min after release, well inside the +3h window
  });
  assert.ok(report.warnings.some((w) => /live or imminent/.test(w)));
});

test("buildMeridianMacroReport: 'live or imminent' warning is withheld hours after the release today", () => {
  const report = buildMeridianMacroReport({
    ...baseInput,
    time: "08:30",
    days_until: 0,
    now_et_minutes: 19 * 60 + 53, // 19:53 ET — 11+ hours after an 08:30 release
  });
  assert.ok(
    !report.warnings.some((w) => /live or imminent/.test(w)),
    "a member checking hours after close should not see 'live or imminent'"
  );
});

test("buildMeridianMacroReport: 'live or imminent' falls back to day-only check when the clock is unavailable", () => {
  const report = buildMeridianMacroReport({
    ...baseInput,
    time: "08:30",
    days_until: 0,
    now_et_minutes: null,
  });
  assert.ok(report.warnings.some((w) => /live or imminent/.test(w)));
});

test("buildMeridianMacroReport: 'live or imminent' warning does not show for a future day", () => {
  const report = buildMeridianMacroReport({
    ...baseInput,
    time: "08:30",
    days_until: 3,
    now_et_minutes: 8 * 60,
  });
  assert.ok(!report.warnings.some((w) => /live or imminent/.test(w)));
});
