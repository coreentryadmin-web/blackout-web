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

/* ── "imminent" is a distance, not a state ───────────────────────────────────────────── */

/**
 * Measured on prod 2026-08-21 at 12:52 ET. All three names that reported that MORNING were still
 * headlined "Imminent print — stand aside for reaction" — six hours after the numbers were out,
 * on a Report tab that rendered `report.headline` as its primary <h3>.
 *
 *   BEKE 06:00 ET  post_print "Beat · EPS +50% · Rev +3%"     verdict bullish
 *   BJ   06:45 ET  post_print "Beat · EPS +14.3% · Rev +8.9%"  verdict bullish
 *   BKE  06:50 ET  post_print "Mixed print vs street"          verdict neutral
 */
const PRINTED_TODAY = [
  { ticker: "BEKE", lean: "beat" as const, expect: /printed — beat/ },
  { ticker: "BJ", lean: "beat" as const, expect: /printed — beat/ },
  { ticker: "BKE", lean: "inline" as const, expect: /printed — mixed vs street/ },
];

function reportFor(over: Record<string, unknown>) {
  // Built from `baseInput`, the fixture the rest of this file uses, so these cases exercise the
  // same required shape as every other test rather than a hand-rolled partial.
  return buildMeridianEarningsReport({ ...baseInput, earnings_yoy: null, ...over } as Parameters<
    typeof buildMeridianEarningsReport
  >[0]);
}

test("a print that has already landed is never headlined as imminent", () => {
  for (const c of PRINTED_TODAY) {
    const r = reportFor({
      ticker: c.ticker,
      days_until: 0,
      post_print: { lean: c.lean, headline: "Beat · EPS +50%" },
    });
    assert.doesNotMatch(
      r.headline,
      /imminent/i,
      `${c.ticker}: the numbers are out; "imminent" is false and the advice premised on it is too`
    );
    // ...and it must not fall through to the other forward-looking phrasing either.
    assert.doesNotMatch(r.headline, /into earnings/i, `${c.ticker}: "into earnings" is also forward-looking`);
    assert.match(r.headline, c.expect, `${c.ticker}: headline should describe the print that happened`);
  }
});

test("an actually-upcoming print keeps the imminent headline", () => {
  // The guard must not swallow the case the sentence exists for.
  const r = reportFor({ days_until: 0, post_print: null });
  assert.match(r.headline, /Imminent print — stand aside for reaction/);
  const unknown = reportFor({ days_until: 1, post_print: { lean: "unknown", headline: null } });
  assert.match(unknown.headline, /Imminent print/, "an unknown lean is not a print");
});

test("confidence stops being pinned to low once the print is out", () => {
  // The `imminent -> low` hedge is there because an UNKNOWN upcoming print dominates any signal
  // stack. Post-print that uncertainty is resolved, so holding "low" all session understates a
  // read the print itself informed.
  //
  // `baseInput` is the aligned-bullish fixture (test 1 asserts score >= 3), so it is strong
  // enough for the score-derived confidence to rise ABOVE low — which is what makes this test
  // able to fail. A weak fixture would stay "low" either way and pin nothing.
  const upcoming = reportFor({ days_until: 0, post_print: null });
  assert.equal(upcoming.confidence, "low", "pre-print the hedge must still apply");

  const landed = reportFor({ days_until: 0, post_print: { lean: "beat", headline: "Beat" } });
  assert.notEqual(
    landed.confidence,
    "low",
    "once the numbers are out, confidence must be derived from the signals rather than pinned by " +
      "a hedge against an uncertainty that no longer exists"
  );
  assert.ok(Math.abs(landed.score) >= 3, "guard: this fixture must actually carry signal");
});

test("the verdict branch is untouched — an inline print does not get re-routed", () => {
  // `imminent` deliberately keeps its day-distance meaning, because the verdict falls through to
  // the pre-print signal stack on `!imminent`. Widening it would flip an inline print's neutral
  // verdict to whatever the anticipation score said, which is the opposite of an improvement.
  const inline = reportFor({ days_until: 0, post_print: { lean: "inline", headline: "Mixed" } });
  assert.equal(inline.verdict, "neutral", "an inline print stays neutral, not scored off anticipation");
});
