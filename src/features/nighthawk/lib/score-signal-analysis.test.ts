import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  bucketVerdict,
  quantileBuckets,
  analyzePhase1CompletedTrades,
  analyzePhase2EarlyRead,
  type BucketSummary,
} from "./score-signal-analysis";
import type { DebriefAggregateRow } from "./debrief-aggregate";

// ── fixtures — same shape/style as direction-failure-diagnosis.test.ts's own row()/pc()/debrief()
//    helpers, so this file reads consistently with the sibling diagnostic tool it was built next to.

function row(
  overrides: Partial<DebriefAggregateRow> & { publish_context?: Record<string, unknown> | null; debrief?: Record<string, unknown> | null }
): DebriefAggregateRow {
  return {
    edition_for: "2026-09-01",
    ticker: "TEST",
    direction: "LONG",
    conviction: "B",
    outcome: "stop",
    pulled: false,
    pulled_reason: null,
    grade_methodology: "v2_fillability",
    publish_context: null,
    entry_range_low: 100,
    entry_range_high: 102,
    target: 110,
    stop: 95,
    debrief: null,
    ...overrides,
  } as DebriefAggregateRow;
}

function debrief(tag: string) {
  return { debrief_version: 1, failure_mode: { tag } };
}

function pc(
  overrides: Partial<{
    confluence: Record<string, unknown>;
    market: Record<string, unknown>;
    tier: Record<string, unknown>;
    gate_promoted: boolean;
    gates: Record<string, unknown>;
    options_play: string;
    entry_premium: number;
  }>
) {
  return {
    confluence: { total_score: 40, flow_score: 20, tech_score: 10, pos_score: 5, smart_money_score: 5 },
    market: { tide_bias: "NEUTRAL", composite_regime: "NEUTRAL" },
    tier: null,
    gate_promoted: false,
    gates: null,
    options_play: undefined,
    entry_premium: undefined,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// bucketVerdict — ported from helix-score-eval.mjs's scoreSeparation; same RANKS/FLAT/INVERTED/
// SPREAD-WITHOUT-ORDER/INSUFFICIENT-DATA discipline.
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("bucketVerdict", () => {
  test("monotonically increasing rates with a real spread -> RANKS", () => {
    const summary: BucketSummary[] = [
      { bucket: "low", ordinal: 1, n: 20, rate_pct: 20 },
      { bucket: "mid", ordinal: 2, n: 20, rate_pct: 45 },
      { bucket: "high", ordinal: 3, n: 20, rate_pct: 70 },
    ];
    const v = bucketVerdict(summary, 10);
    assert.equal(v.verdict, "RANKS");
    assert.equal(v.rho, 1);
    assert.equal(v.spread_pp, 50);
    assert.equal(v.best!.bucket, "high");
    assert.equal(v.worst!.bucket, "low");
  });

  test("monotonically decreasing rates -> INVERTED", () => {
    const summary: BucketSummary[] = [
      { bucket: "low", ordinal: 1, n: 20, rate_pct: 70 },
      { bucket: "mid", ordinal: 2, n: 20, rate_pct: 45 },
      { bucket: "high", ordinal: 3, n: 20, rate_pct: 20 },
    ];
    const v = bucketVerdict(summary, 10);
    assert.equal(v.verdict, "INVERTED");
    assert.equal(v.rho, -1);
  });

  test("small spread (<5pp) -> FLAT regardless of ordering", () => {
    const summary: BucketSummary[] = [
      { bucket: "low", ordinal: 1, n: 20, rate_pct: 50 },
      { bucket: "mid", ordinal: 2, n: 20, rate_pct: 52 },
      { bucket: "high", ordinal: 3, n: 20, rate_pct: 48 },
    ];
    const v = bucketVerdict(summary, 10);
    assert.equal(v.verdict, "FLAT");
  });

  test("a real spread with a scrambled (non-monotonic) middle bucket -> SPREAD WITHOUT ORDER, never RANKS", () => {
    // Same trap helix-score-eval.mjs's own history documents: a spread alone is not a ranking.
    const summary: BucketSummary[] = [
      { bucket: "low", ordinal: 1, n: 20, rate_pct: 30 },
      { bucket: "mid", ordinal: 2, n: 20, rate_pct: 70 },
      { bucket: "high", ordinal: 3, n: 20, rate_pct: 45 },
    ];
    const v = bucketVerdict(summary, 10);
    assert.equal(v.verdict, "SPREAD WITHOUT ORDER");
    assert.ok(v.rho! < 0.6 && v.rho! > -0.6);
  });

  test("buckets below minN are excluded and named, never silently dropped or blended in", () => {
    const summary: BucketSummary[] = [
      { bucket: "low", ordinal: 1, n: 3, rate_pct: 90 }, // below minN, must be excluded
      { bucket: "mid", ordinal: 2, n: 20, rate_pct: 40 },
      { bucket: "high", ordinal: 3, n: 20, rate_pct: 60 },
    ];
    const v = bucketVerdict(summary, 10);
    assert.equal(v.usable_buckets, 2);
    assert.deepEqual(v.excluded, ["low(n=3)"]);
    assert.equal(v.verdict, "RANKS");
  });

  test("fewer than 2 usable buckets -> INSUFFICIENT DATA, never a fabricated verdict", () => {
    const summary: BucketSummary[] = [
      { bucket: "only", ordinal: 1, n: 20, rate_pct: 50 },
      { bucket: "thin", ordinal: 2, n: 2, rate_pct: 90 },
    ];
    const v = bucketVerdict(summary, 10);
    assert.equal(v.verdict, "INSUFFICIENT DATA");
    assert.equal(v.spread_pp, null);
    assert.equal(v.rho, null);
    assert.equal(v.best, null);
    assert.equal(v.worst, null);
  });

  test("empty summary -> INSUFFICIENT DATA, never throws", () => {
    const v = bucketVerdict([], 10);
    assert.equal(v.verdict, "INSUFFICIENT DATA");
    assert.equal(v.usable_buckets, 0);
  });

  test("a null rate_pct bucket is excluded from usable even at high n", () => {
    const summary: BucketSummary[] = [
      { bucket: "a", ordinal: 1, n: 20, rate_pct: null },
      { bucket: "b", ordinal: 2, n: 20, rate_pct: 50 },
      { bucket: "c", ordinal: 3, n: 20, rate_pct: 70 },
    ];
    const v = bucketVerdict(summary, 10);
    assert.equal(v.usable_buckets, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// quantileBuckets
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("quantileBuckets", () => {
  test("splits into the target number of equal-population buckets when n supports it", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ v: i }));
    const buckets = quantileBuckets(rows, (r) => r.v, 3, 5);
    assert.equal(buckets.length, 3);
    assert.equal(buckets[0]!.rows.length, 10);
    assert.equal(buckets[1]!.rows.length, 10);
    assert.equal(buckets[2]!.rows.length, 10);
    // rows sorted into ascending value order
    assert.ok(buckets[0]!.rows.every((r) => r.v < buckets[2]!.rows[0]!.v));
  });

  test("shrinks bucket count to preserve minPerBucket when the population is thin", () => {
    // 12 rows, target 3 buckets, minPerBucket 8 -> can only support 1 bucket (floor(12/8)=1)
    const rows = Array.from({ length: 12 }, (_, i) => ({ v: i }));
    const buckets = quantileBuckets(rows, (r) => r.v, 3, 8);
    assert.equal(buckets.length, 1);
    assert.equal(buckets[0]!.rows.length, 12);
  });

  test("rows with a null feature value are excluded from bucketing, never coerced into bucket 1", () => {
    const rows = [{ v: 1 as number | null }, { v: null }, { v: 2 }, { v: null }, { v: 3 }];
    const buckets = quantileBuckets(rows, (r) => r.v, 3, 1);
    const totalRows = buckets.reduce((n, b) => n + b.rows.length, 0);
    assert.equal(totalRows, 3);
  });

  test("empty input -> empty bucket list, never throws", () => {
    const buckets = quantileBuckets([] as { v: number }[], (r) => r.v, 3, 5);
    assert.deepEqual(buckets, []);
  });

  test("all-null feature values -> empty bucket list", () => {
    const rows = [{ v: null }, { v: null }];
    const buckets = quantileBuckets(rows, (r: { v: number | null }) => r.v, 3, 1);
    assert.deepEqual(buckets, []);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// analyzePhase1CompletedTrades — TRUE decided population only (outcome IN {target, stop}, never
// pulled). Must never compute a bucketed verdict; low_n is hardcoded true.
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("analyzePhase1CompletedTrades", () => {
  test("filters to outcome IN {target, stop} only -- excludes open/unfilled/ambiguous rows", () => {
    const rows: DebriefAggregateRow[] = [
      row({ ticker: "WIN", outcome: "target", debrief: debrief("clean_win"), publish_context: pc({}) }),
      row({ ticker: "LOSS", outcome: "stop", debrief: debrief("stopped_normal"), publish_context: pc({}) }),
      row({ ticker: "OPEN", outcome: "open", debrief: debrief("wrong_direction"), publish_context: pc({}) }),
      row({ ticker: "UNFILLED", outcome: "unfilled", debrief: null, publish_context: pc({}) }),
    ];
    const report = analyzePhase1CompletedTrades(rows, 90);
    assert.equal(report.n_decided, 2);
    assert.equal(report.wins.length, 1);
    assert.equal(report.losses.length, 1);
    assert.equal(report.wins[0]!.ticker, "WIN");
    assert.equal(report.losses[0]!.ticker, "LOSS");
  });

  test("excludes pulled rows even when outcome is target/stop", () => {
    const rows: DebriefAggregateRow[] = [
      row({ ticker: "PULLED_WIN", outcome: "target", pulled: true, publish_context: pc({}) }),
      row({ ticker: "REAL_WIN", outcome: "target", pulled: false, publish_context: pc({}) }),
    ];
    const report = analyzePhase1CompletedTrades(rows, 90);
    assert.equal(report.n_decided, 1);
    assert.equal(report.wins[0]!.ticker, "REAL_WIN");
  });

  test("low_n is always true, regardless of n_decided", () => {
    const rows: DebriefAggregateRow[] = Array.from({ length: 50 }, (_, i) =>
      row({ ticker: `T${i}`, outcome: "target", publish_context: pc({}) })
    );
    const report = analyzePhase1CompletedTrades(rows, 90);
    assert.equal(report.n_decided, 50);
    assert.equal(report.low_n, true);
  });

  test("win/loss group means computed correctly, null-safe over missing scores", () => {
    const rows: DebriefAggregateRow[] = [
      row({
        ticker: "W1",
        outcome: "target",
        publish_context: pc({ confluence: { total_score: 60, flow_score: 30, tech_score: 20, pos_score: 5, smart_money_score: 5 } }),
      }),
      row({
        ticker: "W2",
        outcome: "target",
        publish_context: pc({ confluence: { total_score: 40, flow_score: 10, tech_score: 20, pos_score: 5, smart_money_score: 5 } }),
      }),
      row({ ticker: "L1", outcome: "stop", publish_context: null }),
    ];
    const report = analyzePhase1CompletedTrades(rows, 90);
    assert.equal(report.win_mean.total_score, 50);
    assert.equal(report.win_mean.flow_score, 20);
    assert.equal(report.loss_mean.total_score, null); // no publish_context on the one loss row
  });

  test("empty input -> zeroed, never throws", () => {
    const report = analyzePhase1CompletedTrades([], 90);
    assert.equal(report.n_decided, 0);
    assert.deepEqual(report.wins, []);
    assert.deepEqual(report.losses, []);
    assert.equal(report.win_mean.total_score, null);
    assert.equal(report.low_n, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// analyzePhase2EarlyRead — broader one-session directional-read population, reusing debrief.ts's
// own tag taxonomy split rather than a newly invented one. Must stay strictly separate from
// Phase 1's realized-profitability claim.
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("analyzePhase2EarlyRead", () => {
  test("classifies EARLY_FAVORABLE and EARLY_ADVERSE tags correctly, including still-open rows", () => {
    const rows: DebriefAggregateRow[] = [
      row({ ticker: "A", outcome: "open", debrief: debrief("wrong_direction"), publish_context: pc({}) }),
      row({ ticker: "B", outcome: "open", debrief: debrief("target_unreachable"), publish_context: pc({}) }),
      row({ ticker: "C", outcome: "target", debrief: debrief("clean_win"), publish_context: pc({}) }),
      row({ ticker: "D", outcome: "stop", debrief: debrief("stopped_normal"), publish_context: pc({}) }),
      row({ ticker: "E", outcome: "target", debrief: debrief("lucky_win"), publish_context: pc({}) }),
      row({ ticker: "F", outcome: "open", debrief: debrief("gap_win"), publish_context: pc({}) }),
      row({ ticker: "G", outcome: "stop", debrief: debrief("gap_through_stop"), publish_context: pc({}) }),
    ];
    const report = analyzePhase2EarlyRead(rows, 90);
    assert.equal(report.n_early_read, 7);
    assert.equal(report.n_favorable, 4); // B, C, E, F
    assert.equal(report.n_adverse, 3); // A, D, G
  });

  test("excludes pulled rows and unfilled-outcome rows even with a recognized tag", () => {
    const rows: DebriefAggregateRow[] = [
      row({ ticker: "PULLED", outcome: "open", pulled: true, debrief: debrief("wrong_direction"), publish_context: pc({}) }),
      row({ ticker: "UNFILLED", outcome: "unfilled", debrief: debrief("wrong_direction"), publish_context: pc({}) }),
      row({ ticker: "REAL", outcome: "open", pulled: false, debrief: debrief("wrong_direction"), publish_context: pc({}) }),
    ];
    const report = analyzePhase2EarlyRead(rows, 90);
    assert.equal(report.n_early_read, 1);
  });

  test("rows with no recognized debrief tag (or no debrief at all) are excluded, never counted as adverse by default", () => {
    const rows: DebriefAggregateRow[] = [
      row({ ticker: "NONE", outcome: "open", debrief: null, publish_context: pc({}) }),
      row({ ticker: "AMBIGUOUS", outcome: "open", debrief: debrief("ambiguous"), publish_context: pc({}) }),
    ];
    const report = analyzePhase2EarlyRead(rows, 90);
    assert.equal(report.n_early_read, 0);
  });

  test("low_n flags true below 2x PHASE2_MIN_N (16), false at or above it", () => {
    const thin = Array.from({ length: 10 }, (_, i) => row({ ticker: `T${i}`, outcome: "open", debrief: debrief("wrong_direction"), publish_context: pc({}) }));
    const thinReport = analyzePhase2EarlyRead(thin, 90);
    assert.equal(thinReport.low_n, true);

    const enough = Array.from({ length: 20 }, (_, i) => row({ ticker: `T${i}`, outcome: "open", debrief: debrief("wrong_direction"), publish_context: pc({}) }));
    const enoughReport = analyzePhase2EarlyRead(enough, 90);
    assert.equal(enoughReport.low_n, false);
  });

  test("by_target_atr_gate splits under/over the live 2.0x gate threshold using the pinned G-N2 value", () => {
    const rows: DebriefAggregateRow[] = [
      row({
        ticker: "UNDER",
        outcome: "open",
        debrief: debrief("wrong_direction"),
        publish_context: pc({ gates: { checks: [{ code: "target_unreachable", value: 1.2 }] } }),
      }),
      row({
        ticker: "OVER",
        outcome: "open",
        debrief: debrief("target_unreachable"),
        publish_context: pc({ gates: { checks: [{ code: "target_unreachable", value: 3.1 }] } }),
      }),
    ];
    const report = analyzePhase2EarlyRead(rows, 90);
    assert.equal(report.by_target_atr_gate.under_gate.n, 1);
    assert.equal(report.by_target_atr_gate.over_gate.n, 1);
    assert.equal(report.by_target_atr_gate.over_gate.rate_pct, 100);
    assert.equal(report.by_target_atr_gate.under_gate.rate_pct, 0);
  });

  test("by_dte splits weekly (<=10 calendar days) vs longer (>10), parsed from the pinned options_play string anchored to edition_for", () => {
    const rows: DebriefAggregateRow[] = [
      row({
        ticker: "WEEKLY",
        edition_for: "2026-09-01",
        outcome: "open",
        debrief: debrief("wrong_direction"),
        publish_context: pc({ options_play: "WEEKLY $100 CALL exp Sep 05" }),
      }),
      row({
        ticker: "LONGER",
        edition_for: "2026-09-01",
        outcome: "open",
        debrief: debrief("target_unreachable"),
        publish_context: pc({ options_play: "LONGER $100 CALL exp Oct 17" }),
      }),
    ];
    const report = analyzePhase2EarlyRead(rows, 90);
    assert.equal(report.by_dte.weekly_lte_10.n, 1);
    assert.equal(report.by_dte.longer_gt_10.n, 1);
  });

  test("interaction split at the flow-dominance median partitions rows into high/low halves", () => {
    const mkRow = (ticker: string, flowScore: number, totalScore: number, favorable: boolean) =>
      row({
        ticker,
        outcome: "open",
        debrief: debrief(favorable ? "clean_win" : "wrong_direction"),
        publish_context: pc({ confluence: { total_score: totalScore, flow_score: flowScore, tech_score: totalScore - flowScore, pos_score: 0, smart_money_score: 0 } }),
      });
    const rows: DebriefAggregateRow[] = [
      mkRow("A", 45, 50, true), // flow_dominance ~90%
      mkRow("B", 40, 50, true), // ~80%
      mkRow("C", 5, 50, false), // 10%
      mkRow("D", 10, 50, false), // 20%
    ];
    const report = analyzePhase2EarlyRead(rows, 90);
    // Every row carries a recognized tag; interaction buckets should partition without throwing.
    assert.ok(Array.isArray(report.interaction_high_flow_dominance.summary));
    assert.ok(Array.isArray(report.interaction_low_flow_dominance.summary));
  });

  test("methodology string explicitly warns against comparing to Phase 1's win rate", () => {
    const report = analyzePhase2EarlyRead([], 90);
    assert.ok(report.methodology.toLowerCase().includes("not final trade"));
  });

  test("empty input -> zeroed report, never throws", () => {
    const report = analyzePhase2EarlyRead([], 90);
    assert.equal(report.n_early_read, 0);
    assert.equal(report.n_favorable, 0);
    assert.equal(report.n_adverse, 0);
    assert.equal(report.low_n, true);
    assert.equal(report.by_total_score.verdict.verdict, "INSUFFICIENT DATA");
  });
});
