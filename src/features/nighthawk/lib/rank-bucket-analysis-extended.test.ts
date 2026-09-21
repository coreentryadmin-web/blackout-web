import test from "node:test";
import assert from "node:assert/strict";
import {
  computeExtendedRankBucketStats,
  computeRankOutcomeCorrelation,
  computeDirectionBucketStats,
  computeConvictionBucketStats,
  computeSetupTypeBucketStats,
  computeTrendRegimeBucketStats,
  buildDiscoveryRowIndex,
  classifySetupTypeHeuristic,
  findTop5Losers,
  findRejectedWinners,
  DEFAULT_LARGE_MOVE_THRESHOLD_PCT,
  CORRELATION_MIN_N,
  SETUP_TYPE_BALANCED_MARGIN,
} from "./rank-bucket-analysis-extended";
import type { NighthawkCandidateSnapshotRow } from "@/lib/db";

function row(overrides: Partial<NighthawkCandidateSnapshotRow> = {}): NighthawkCandidateSnapshotRow {
  return {
    id: 1,
    edition_for: "2026-09-15",
    ticker: "AAPL",
    stage: "rank_final",
    observed_at: "2026-09-15T00:00:00.000Z",
    rank: null,
    score: null,
    gov_penalty: null,
    rejection_reason: null,
    selected_for_publish: null,
    snapshot_json: {},
    forward_returns: null,
    ...overrides,
  };
}

function longRow(
  rank: number | null,
  eodPct: number | null,
  opts: Partial<{ h1: number | null; high: number | null; low: number | null; ticker: string; edition_for: string; score: number | null; stage: string }> = {}
): NighthawkCandidateSnapshotRow {
  return row({
    rank,
    ticker: opts.ticker ?? "AAPL",
    edition_for: opts.edition_for ?? "2026-09-15",
    score: opts.score ?? null,
    stage: opts.stage ?? "rank_final",
    snapshot_json: { direction: "long" },
    forward_returns: {
      horizons: { h1: opts.h1 ?? eodPct, eod: eodPct },
      session_high_pct: opts.high ?? (eodPct != null ? Math.max(eodPct, 0) + 1 : null),
      session_low_pct: opts.low ?? (eodPct != null ? Math.min(eodPct, 0) - 1 : null),
    },
  });
}

// ── computeExtendedRankBucketStats ──────────────────────────────────────────────

test("computeExtendedRankBucketStats: median MFE/MAE computed correctly", () => {
  const rows = [
    row({ rank: 1, snapshot_json: { direction: "long" }, forward_returns: { horizons: { eod: 2 }, session_high_pct: 4, session_low_pct: -2 } }),
    row({ rank: 2, snapshot_json: { direction: "long" }, forward_returns: { horizons: { eod: 2 }, session_high_pct: 8, session_low_pct: -6 } }),
  ];
  const stats = computeExtendedRankBucketStats(rows);
  const bucket = stats.find((b) => b.bucket === "rank_1_5")!;
  assert.equal(bucket.median_mfe_pct, 6); // median of [4, 8]
  assert.equal(bucket.median_mae_pct, -4); // median of [-2, -6]
});

test("computeExtendedRankBucketStats: mfe_mae_ratio is |median mfe| / |median mae|", () => {
  const rows = [row({ rank: 1, snapshot_json: { direction: "long" }, forward_returns: { horizons: { eod: 1 }, session_high_pct: 10, session_low_pct: -5 } })];
  const stats = computeExtendedRankBucketStats(rows);
  const bucket = stats.find((b) => b.bucket === "rank_1_5")!;
  assert.equal(bucket.mfe_mae_ratio, 2);
});

test("computeExtendedRankBucketStats: mfe_mae_ratio is null when median MAE is 0 or missing", () => {
  const rows = [row({ rank: 1, snapshot_json: { direction: "long" }, forward_returns: { horizons: { eod: 1 }, session_high_pct: 10, session_low_pct: 0 } })];
  const stats = computeExtendedRankBucketStats(rows);
  const bucket = stats.find((b) => b.bucket === "rank_1_5")!;
  assert.equal(bucket.mfe_mae_ratio, null);
});

test("computeExtendedRankBucketStats: large_winner_rate_pct / large_loser_rate_pct respect the threshold", () => {
  const rows = [longRow(1, 15), longRow(2, 5), longRow(3, -12), longRow(4, -3)];
  const stats = computeExtendedRankBucketStats(rows, { largeMoveThresholdPct: DEFAULT_LARGE_MOVE_THRESHOLD_PCT });
  const bucket = stats.find((b) => b.bucket === "rank_1_5")!;
  assert.equal(bucket.large_winner_rate_pct, 25); // 1 of 4 >= 10
  assert.equal(bucket.large_loser_rate_pct, 25); // 1 of 4 <= -10
});

test("computeExtendedRankBucketStats: win_rate_eod_ci95 and mean_eod_ci95 are null at n<2, present at n>=2", () => {
  const single = computeExtendedRankBucketStats([longRow(1, 5)]).find((b) => b.bucket === "rank_1_5")!;
  assert.equal(single.mean_eod_ci95, null);

  const many = computeExtendedRankBucketStats([longRow(1, 5), longRow(2, 3), longRow(3, 7)]).find((b) => b.bucket === "rank_1_5")!;
  assert.notEqual(many.mean_eod_ci95, null);
  assert.ok(many.mean_eod_ci95!.low <= many.mean_eod_pct! && many.mean_eod_pct! <= many.mean_eod_ci95!.high);
});

test("computeExtendedRankBucketStats: an empty row set never throws and returns all buckets", () => {
  const stats = computeExtendedRankBucketStats([]);
  assert.equal(stats.length, 5);
  for (const b of stats) {
    assert.equal(b.median_mfe_pct, null);
    assert.equal(b.mfe_mae_ratio, null);
    assert.equal(b.large_winner_rate_pct, null);
    assert.equal(b.win_rate_eod_ci95, null);
  }
});

// ── computeRankOutcomeCorrelation ───────────────────────────────────────────────

test("computeRankOutcomeCorrelation: below CORRELATION_MIN_N reports low_n and null rho, never fabricated", () => {
  const rows = Array.from({ length: CORRELATION_MIN_N - 1 }, (_, i) => longRow(i + 1, i));
  const result = computeRankOutcomeCorrelation(rows, "eod");
  assert.equal(result.low_n, true);
  assert.equal(result.rho, null);
  assert.match(result.reason!, new RegExp(`fewer than ${CORRELATION_MIN_N}`));
});

test("computeRankOutcomeCorrelation: perfect positive rank-outcome relationship yields rho close to 1 or -1 (direction depends on rank convention)", () => {
  // rank 1 (best) paired with the WORST outcome, rank N (worst) paired with the BEST outcome --
  // a monotonic relationship either way should yield |rho| very close to 1, not 0.
  const rows = Array.from({ length: CORRELATION_MIN_N + 5 }, (_, i) => longRow(i + 1, i));
  const result = computeRankOutcomeCorrelation(rows, "eod");
  assert.equal(result.low_n, false);
  assert.ok(result.rho != null && Math.abs(result.rho) > 0.99);
});

test("computeRankOutcomeCorrelation: rows missing rank or the requested measure are excluded from n, not imputed", () => {
  const rows = [
    ...Array.from({ length: CORRELATION_MIN_N }, (_, i) => longRow(i + 1, i)),
    row({ rank: null, snapshot_json: { direction: "long" }, forward_returns: { horizons: { eod: 5 } } }), // no rank
    row({ rank: 99, snapshot_json: { direction: "long" }, forward_returns: null }), // no forward_returns
  ];
  const result = computeRankOutcomeCorrelation(rows, "eod");
  assert.equal(result.n, CORRELATION_MIN_N);
});

test("computeRankOutcomeCorrelation: zero variance in outcome reports rho=null with an explicit reason, not 0", () => {
  const rows = Array.from({ length: CORRELATION_MIN_N + 2 }, (_, i) => longRow(i + 1, 5)); // every outcome identical
  const result = computeRankOutcomeCorrelation(rows, "eod");
  assert.equal(result.rho, null);
  assert.equal(result.low_n, false);
  assert.match(result.reason!, /no variance/);
});

// ── direction / conviction / setup-type / trend-regime segmentation ────────────

test("computeDirectionBucketStats: segments long vs short vs unknown", () => {
  const rows = [
    longRow(1, 5),
    row({ rank: 2, snapshot_json: { direction: "short" }, forward_returns: { horizons: { eod: 4 } } }),
    row({ rank: 3, snapshot_json: {}, forward_returns: { horizons: { eod: 1 } } }),
  ];
  const stats = computeDirectionBucketStats(rows);
  assert.equal(stats.find((s) => s.key === "long")!.n, 1);
  assert.equal(stats.find((s) => s.key === "short")!.n, 1);
  assert.equal(stats.find((s) => s.key === "unknown")!.n, 1);
});

test("computeConvictionBucketStats: segments A/B/C/unknown", () => {
  const rows = [
    row({ snapshot_json: { conviction: "A", direction: "long" }, forward_returns: { horizons: { eod: 5 } } }),
    row({ snapshot_json: { conviction: "B", direction: "long" }, forward_returns: { horizons: { eod: 2 } } }),
    row({ snapshot_json: { conviction: "Z", direction: "long" }, forward_returns: { horizons: { eod: 1 } } }), // invalid value -> unknown
  ];
  const stats = computeConvictionBucketStats(rows);
  assert.equal(stats.find((s) => s.key === "A")!.n, 1);
  assert.equal(stats.find((s) => s.key === "B")!.n, 1);
  assert.equal(stats.find((s) => s.key === "unknown")!.n, 1);
});

test("classifySetupTypeHeuristic: labels by the dominant component score", () => {
  const flowLed = row({ snapshot_json: { components: { flow_score: 20, tech_score: 5, pos_score: 2 } } });
  assert.equal(classifySetupTypeHeuristic(flowLed), "flow_led");

  const techLed = row({ snapshot_json: { components: { flow_score: 5, tech_score: 20, pos_score: 2 } } });
  assert.equal(classifySetupTypeHeuristic(techLed), "technical_led");
});

test("classifySetupTypeHeuristic: 'balanced' when top two are within SETUP_TYPE_BALANCED_MARGIN", () => {
  const balanced = row({ snapshot_json: { components: { flow_score: 10, tech_score: 10 + SETUP_TYPE_BALANCED_MARGIN, pos_score: 0 } } });
  assert.equal(classifySetupTypeHeuristic(balanced), "balanced");

  const notBalanced = row({ snapshot_json: { components: { flow_score: 10, tech_score: 10 + SETUP_TYPE_BALANCED_MARGIN + 1, pos_score: 0 } } });
  assert.equal(classifySetupTypeHeuristic(notBalanced), "technical_led");
});

test("classifySetupTypeHeuristic: 'unknown' when no components object exists (true for rank_final/most rejected rows today)", () => {
  assert.equal(classifySetupTypeHeuristic(row({ snapshot_json: { direction: "long", conviction: "A" } })), "unknown");
});

test("computeSetupTypeBucketStats: aggregates by the heuristic label", () => {
  const rows = [
    row({ snapshot_json: { direction: "long", components: { flow_score: 20, tech_score: 1 } }, forward_returns: { horizons: { eod: 5 } } }),
    row({ snapshot_json: { direction: "long" }, forward_returns: { horizons: { eod: 1 } } }), // unknown, no components
  ];
  const stats = computeSetupTypeBucketStats(rows);
  assert.equal(stats.find((s) => s.key === "flow_led")!.n, 1);
  assert.equal(stats.find((s) => s.key === "unknown")!.n, 1);
});

test("computeTrendRegimeBucketStats: joins the discovery-stage market_regime.trend via the built index", () => {
  const discoveryRows = [
    row({ ticker: "AAPL", edition_for: "2026-09-15", stage: "discovery", snapshot_json: { market_regime: { trend: "up" } } }),
    row({ ticker: "MSFT", edition_for: "2026-09-15", stage: "discovery", snapshot_json: { market_regime: { trend: "down" } } }),
  ];
  const index = buildDiscoveryRowIndex(discoveryRows);
  const rankedRows = [
    row({ ticker: "AAPL", edition_for: "2026-09-15", rank: 1, snapshot_json: { direction: "long" }, forward_returns: { horizons: { eod: 5 } } }),
    row({ ticker: "MSFT", edition_for: "2026-09-15", rank: 2, snapshot_json: { direction: "long" }, forward_returns: { horizons: { eod: -3 } } }),
    row({ ticker: "TSLA", edition_for: "2026-09-15", rank: 3, snapshot_json: { direction: "long" }, forward_returns: { horizons: { eod: 1 } } }), // no discovery sibling -> unknown
  ];
  const stats = computeTrendRegimeBucketStats(rankedRows, index);
  assert.equal(stats.find((s) => s.key === "up")!.n, 1);
  assert.equal(stats.find((s) => s.key === "down")!.n, 1);
  assert.equal(stats.find((s) => s.key === "unknown")!.n, 1);
});

// ── findTop5Losers / findRejectedWinners ────────────────────────────────────────

test("findTop5Losers: only rank_final rows ranked 1-5 with an adverse move at/below the threshold", () => {
  const rows = [
    longRow(1, -15, { ticker: "LOSER" }), // large loser, rank 1
    longRow(2, -3, { ticker: "SMALLLOSS" }), // small loss, not "large"
    longRow(8, -20, { ticker: "OUTSIDE_TOP5" }), // rank 8, excluded
    row({ rank: 3, stage: "rejected", snapshot_json: { direction: "long" }, forward_returns: { horizons: { eod: -20 } } }), // rejected, not rank_final
  ];
  const losers = findTop5Losers(rows);
  assert.equal(losers.length, 1);
  assert.equal(losers[0]!.ticker, "LOSER");
});

test("findRejectedWinners: strongly favorable rejected rows are surfaced with a score-based counterfactual estimate", () => {
  const rows = [
    longRow(1, 3, { ticker: "PUBLISHED_A", score: 50 }),
    longRow(2, 1, { ticker: "PUBLISHED_B", score: 40 }),
    row({
      ticker: "REJECTED_WINNER",
      edition_for: "2026-09-15",
      stage: "rejected",
      rank: null,
      score: 45,
      rejection_reason: "sector_concentration",
      snapshot_json: { direction: "long", detail: { stage: "sector_concentration", sector: "tech" } },
      forward_returns: { horizons: { eod: 18 } },
    }),
  ];
  const winners = findRejectedWinners(rows);
  assert.equal(winners.length, 1);
  const w = winners[0]!;
  assert.equal(w.ticker, "REJECTED_WINNER");
  assert.equal(w.rejection_reason, "sector_concentration");
  // score 45 sits between PUBLISHED_A (50) and PUBLISHED_B (40) -- exactly one published score
  // (50) beats it, so it would have placed ~#2 of that night's 2 published plays.
  assert.match(w.would_be_rank_estimate, /~#2 of that night's 2 published/);
});

test("findRejectedWinners: confluence-gate rejects (no score comparison possible) fall back to the discovery rank, labeled honestly", () => {
  const rows = [
    row({
      ticker: "EARLY_WINNER",
      edition_for: "2026-09-15",
      stage: "rejected",
      rank: 7, // discovery-stage rank
      score: null,
      rejection_reason: "confluence_gate",
      snapshot_json: { direction: "long" },
      forward_returns: { horizons: { eod: 25 } },
    }),
  ];
  const winners = findRejectedWinners(rows);
  assert.equal(winners.length, 1);
  assert.match(winners[0]!.would_be_rank_estimate, /discovery-stage rank #7/);
});

test("findRejectedWinners: a row with no direction (never reached scoring) is honestly excluded, never guessed", () => {
  const rows = [
    row({
      stage: "rejected",
      rejection_reason: "confluence_gate",
      snapshot_json: {},
      forward_returns: { horizons: { eod: 30 } },
    }),
  ];
  assert.equal(findRejectedWinners(rows).length, 0);
});
