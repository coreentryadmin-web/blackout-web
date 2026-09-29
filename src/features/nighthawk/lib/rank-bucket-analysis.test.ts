import test from "node:test";
import assert from "node:assert/strict";
import {
  bucketForRank,
  computeRankBucketStats,
  computeRegimeBucketStats,
  regimeBucketFor,
  RANK_BUCKET_LOW_N_THRESHOLD,
  type RankBucketKey,
} from "./rank-bucket-analysis";
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

function longRow(rank: number | null, eodPct: number | null, opts: Partial<{ h1: number | null; high: number | null; low: number | null }> = {}): NighthawkCandidateSnapshotRow {
  return row({
    rank,
    snapshot_json: { direction: "long" },
    forward_returns: {
      horizons: { h1: opts.h1 ?? eodPct, eod: eodPct },
      session_high_pct: opts.high ?? (eodPct != null ? Math.max(eodPct, 0) + 1 : null),
      session_low_pct: opts.low ?? (eodPct != null ? Math.min(eodPct, 0) - 1 : null),
    },
  });
}

function shortRow(rank: number | null, eodPct: number | null): NighthawkCandidateSnapshotRow {
  // eodPct here is the SIGN-ALIGNED favorable reading we want to end up with; the raw stored
  // pct is the underlying's raw (unsigned) move, so it must be negated for a short.
  const rawEod = eodPct == null ? null : -eodPct;
  return row({
    rank,
    snapshot_json: { direction: "short" },
    forward_returns: {
      horizons: { h1: rawEod, eod: rawEod },
      session_high_pct: rawEod != null ? Math.max(rawEod, 0) + 1 : null,
      session_low_pct: rawEod != null ? Math.min(rawEod, 0) - 1 : null,
    },
  });
}

// ── bucketForRank ────────────────────────────────────────────────────────────────

test("bucketForRank: null rank -> rejected_unranked", () => {
  assert.equal(bucketForRank(null), "rejected_unranked");
});

test("bucketForRank: ranks 1-5 -> rank_1_5", () => {
  assert.equal(bucketForRank(1), "rank_1_5");
  assert.equal(bucketForRank(5), "rank_1_5");
});

test("bucketForRank: ranks 6-10 -> rank_6_10", () => {
  assert.equal(bucketForRank(6), "rank_6_10");
  assert.equal(bucketForRank(10), "rank_6_10");
});

test("bucketForRank: ranks 11-25 -> rank_11_25", () => {
  assert.equal(bucketForRank(11), "rank_11_25");
  assert.equal(bucketForRank(25), "rank_11_25");
});

test("bucketForRank: rank 26+ -> rank_26_plus", () => {
  assert.equal(bucketForRank(26), "rank_26_plus");
  assert.equal(bucketForRank(500), "rank_26_plus");
});

// ── computeRankBucketStats: sign-alignment ──────────────────────────────────────

test("computeRankBucketStats: LONG row with a raw positive move reads as favorable (positive) EOD", () => {
  const stats = computeRankBucketStats([longRow(1, 5)]);
  const bucket = stats.find((b) => b.bucket === "rank_1_5")!;
  assert.equal(bucket.n, 1);
  assert.equal(bucket.n_graded, 1);
  assert.equal(bucket.mean_eod_pct, 5);
});

test("computeRankBucketStats: SHORT row benefiting from a raw fall reads as favorable (positive) EOD", () => {
  // Raw underlying move is -5% (a fall); for a SHORT that's favorable, so sign-aligned = +5.
  const stats = computeRankBucketStats([shortRow(1, 5)]);
  const bucket = stats.find((b) => b.bucket === "rank_1_5")!;
  assert.equal(bucket.mean_eod_pct, 5);
});

test("computeRankBucketStats: MFE/MAE sign-alignment for LONG (favorable=high, adverse=low)", () => {
  const raw = row({
    rank: 1,
    snapshot_json: { direction: "long" },
    forward_returns: { horizons: { h1: 2, eod: 2 }, session_high_pct: 8, session_low_pct: -3 },
  });
  const stats = computeRankBucketStats([raw]);
  const bucket = stats.find((b) => b.bucket === "rank_1_5")!;
  assert.equal(bucket.mean_mfe_pct, 8);
  assert.equal(bucket.mean_mae_pct, -3);
});

test("computeRankBucketStats: MFE/MAE sign-alignment for SHORT (favorable=low negated, adverse=high negated)", () => {
  const raw = row({
    rank: 1,
    snapshot_json: { direction: "short" },
    forward_returns: { horizons: { h1: -2, eod: -2 }, session_high_pct: 3, session_low_pct: -8 },
  });
  const stats = computeRankBucketStats([raw]);
  const bucket = stats.find((b) => b.bucket === "rank_1_5")!;
  // Favorable for a short = session_low negated = -(-8) = 8
  assert.equal(bucket.mean_mfe_pct, 8);
  // Adverse for a short = session_high negated = -(3) = -3
  assert.equal(bucket.mean_mae_pct, -3);
});

// ── computeRankBucketStats: missing data is never fabricated ───────────────────

test("computeRankBucketStats: a row with no direction is bucketed but its return stats stay null", () => {
  const raw = row({ rank: 1, snapshot_json: {}, forward_returns: { horizons: { eod: 5 } } });
  const stats = computeRankBucketStats([raw]);
  const bucket = stats.find((b) => b.bucket === "rank_1_5")!;
  assert.equal(bucket.n, 1);
  assert.equal(bucket.n_graded, 0);
  assert.equal(bucket.mean_eod_pct, null);
  assert.equal(bucket.win_rate_eod_pct, null);
});

test("computeRankBucketStats: a row with no forward_returns at all is bucketed but ungraded", () => {
  const raw = row({ rank: 2, snapshot_json: { direction: "long" }, forward_returns: null });
  const stats = computeRankBucketStats([raw]);
  const bucket = stats.find((b) => b.bucket === "rank_1_5")!;
  assert.equal(bucket.n, 1);
  assert.equal(bucket.n_graded, 0);
});

test("computeRankBucketStats: an empty row set returns every bucket at n=0 with all-null stats, never throws", () => {
  const stats = computeRankBucketStats([]);
  assert.equal(stats.length, 5);
  for (const b of stats) {
    assert.equal(b.n, 0);
    assert.equal(b.n_graded, 0);
    assert.equal(b.mean_eod_pct, null);
    assert.equal(b.win_rate_eod_pct, null);
    assert.equal(b.low_n, true);
  }
});

// ── computeRankBucketStats: bucketing + aggregation ─────────────────────────────

test("computeRankBucketStats: rejected row with a rank still buckets by that rank, not rejected_unranked", () => {
  const raw = row({ rank: 3, stage: "rejected", snapshot_json: { direction: "long" }, forward_returns: { horizons: { eod: 4 } } });
  const stats = computeRankBucketStats([raw]);
  const bucket1to5 = stats.find((b) => b.bucket === "rank_1_5")!;
  const rejectedUnranked = stats.find((b) => b.bucket === "rejected_unranked")!;
  assert.equal(bucket1to5.n, 1);
  assert.equal(rejectedUnranked.n, 0);
});

test("computeRankBucketStats: win_rate_eod_pct is the share of graded rows with a positive sign-aligned EOD move", () => {
  const rows = [longRow(1, 5), longRow(2, -3), longRow(3, 2), longRow(4, -1)];
  const stats = computeRankBucketStats(rows);
  const bucket = stats.find((b) => b.bucket === "rank_1_5")!;
  assert.equal(bucket.n_graded, 4);
  assert.equal(bucket.win_rate_eod_pct, 50);
});

test("computeRankBucketStats: mean/median EOD are computed correctly across a bucket", () => {
  const rows = [longRow(1, 2), longRow(2, 4), longRow(3, 6)];
  const stats = computeRankBucketStats(rows);
  const bucket = stats.find((b) => b.bucket === "rank_1_5")!;
  assert.equal(bucket.mean_eod_pct, 4);
  assert.equal(bucket.median_eod_pct, 4);
});

test("computeRankBucketStats: low_n flag reflects the RANK_BUCKET_LOW_N_THRESHOLD constant on n_graded", () => {
  const belowThreshold = Array.from({ length: RANK_BUCKET_LOW_N_THRESHOLD - 1 }, (_, i) => longRow(1, i));
  const atThreshold = Array.from({ length: RANK_BUCKET_LOW_N_THRESHOLD }, (_, i) => longRow(1, i));
  const belowStats = computeRankBucketStats(belowThreshold).find((b) => b.bucket === "rank_1_5")!;
  const atStats = computeRankBucketStats(atThreshold).find((b) => b.bucket === "rank_1_5")!;
  assert.equal(belowStats.low_n, true);
  assert.equal(atStats.low_n, false);
});

test("computeRankBucketStats: buckets are independent -- rows in one bucket never leak into another's stats", () => {
  const rows = [longRow(1, 100), longRow(26, -100)];
  const stats = computeRankBucketStats(rows);
  const top = stats.find((b) => b.bucket === "rank_1_5")!;
  const bottom = stats.find((b) => b.bucket === "rank_26_plus")!;
  assert.equal(top.mean_eod_pct, 100);
  assert.equal(bottom.mean_eod_pct, -100);
});

test("computeRankBucketStats: result always contains all 5 buckets in a stable order", () => {
  const stats = computeRankBucketStats([longRow(1, 1)]);
  assert.deepEqual(
    stats.map((b) => b.bucket),
    ["rank_1_5", "rank_6_10", "rank_11_25", "rank_26_plus", "rejected_unranked"] satisfies RankBucketKey[]
  );
});

// ── regimeBucketFor / computeRegimeBucketStats ──────────────────────────────────

test("regimeBucketFor: multiplier > 1.05 -> expansive", () => {
  assert.equal(regimeBucketFor(row({ snapshot_json: { regime_multiplier: 1.2 } })), "expansive");
});

test("regimeBucketFor: multiplier < 0.95 -> defensive", () => {
  assert.equal(regimeBucketFor(row({ snapshot_json: { regime_multiplier: 0.8 } })), "defensive");
});

test("regimeBucketFor: multiplier between 0.95 and 1.05 inclusive-ish -> neutral", () => {
  assert.equal(regimeBucketFor(row({ snapshot_json: { regime_multiplier: 1.0 } })), "neutral");
});

test("regimeBucketFor: missing/non-numeric multiplier -> unknown, never guessed", () => {
  assert.equal(regimeBucketFor(row({ snapshot_json: {} })), "unknown");
  assert.equal(regimeBucketFor(row({ snapshot_json: { regime_multiplier: "high" } })), "unknown");
});

test("computeRegimeBucketStats: buckets rows by regime and computes sign-aligned EOD stats per bucket", () => {
  const rows = [
    row({ snapshot_json: { direction: "long", regime_multiplier: 1.2 }, forward_returns: { horizons: { eod: 3 } } }),
    row({ snapshot_json: { direction: "long", regime_multiplier: 0.8 }, forward_returns: { horizons: { eod: -3 } } }),
  ];
  const stats = computeRegimeBucketStats(rows);
  const expansive = stats.find((b) => b.regime === "expansive")!;
  const defensive = stats.find((b) => b.regime === "defensive")!;
  assert.equal(expansive.mean_eod_pct, 3);
  assert.equal(defensive.mean_eod_pct, -3);
});

test("computeRegimeBucketStats: result always contains all 4 regime buckets, even with no rows", () => {
  const stats = computeRegimeBucketStats([]);
  assert.deepEqual(
    stats.map((b) => b.regime),
    ["expansive", "neutral", "defensive", "unknown"]
  );
  for (const b of stats) assert.equal(b.n, 0);
});
