import test from "node:test";
import assert from "node:assert/strict";
import { chooseBucketCount, bucketByScoreQuantile, scoreCalibrationVerdict } from "./swing-score-calibration-eval.mjs";

test("chooseBucketCount: never invents more buckets than the population honestly supports", () => {
  assert.equal(chooseBucketCount(5), 1); // below 2x minPerBucket -> single bucket, no split
  assert.equal(chooseBucketCount(31), 10); // 31/3 = 10.3 -> capped at maxBuckets 10
  assert.equal(chooseBucketCount(12), 4); // 12/3 = 4
  assert.equal(chooseBucketCount(9, { minPerBucket: 3 }), 3);
});

test("bucketByScoreQuantile: rows with no usable score/pnl are dropped, never coerced into a bucket", () => {
  const rows = [
    { score: 70, pnlPct: 10 },
    { score: null, pnlPct: 5 },
    { score: 80, pnlPct: null },
    { score: 60, pnlPct: -5 },
  ];
  const buckets = bucketByScoreQuantile(rows, { minPerBucket: 1 });
  const totalN = buckets.reduce((a, b) => a + b.n, 0);
  assert.equal(totalN, 2); // only the two fully-usable rows counted
});

test("bucketByScoreQuantile: low scores land in bucket 0, high scores in the last bucket", () => {
  const rows = [
    { score: 10, pnlPct: -20 },
    { score: 20, pnlPct: -10 },
    { score: 80, pnlPct: 20 },
    { score: 90, pnlPct: 30 },
  ];
  const buckets = bucketByScoreQuantile(rows, { minPerBucket: 1, maxBuckets: 2 });
  assert.equal(buckets.length, 2);
  assert.ok(buckets[0].label.includes("10") || buckets[0].label.includes("20"));
  assert.ok(buckets[1].label.includes("80") || buckets[1].label.includes("90"));
});

test("scoreCalibrationVerdict: monotonic increasing win rate by bucket -> RANKS", () => {
  const summary = [
    { label: "low", n: 5, winRate: 10, avgPnlPct: -20 },
    { label: "mid", n: 5, winRate: 40, avgPnlPct: -5 },
    { label: "high", n: 5, winRate: 80, avgPnlPct: 25 },
  ];
  const v = scoreCalibrationVerdict(summary);
  assert.equal(v.verdict, "RANKS");
  assert.ok(v.rho > 0.6);
});

test("scoreCalibrationVerdict: a real spread with SCRAMBLED order is SPREAD WITHOUT ORDER, never RANKS", () => {
  // Mirrors the exact helix-score-eval.mjs trap: mid bucket worst, low bucket best.
  const summary = [
    { label: "low", n: 5, winRate: 55, avgPnlPct: 5 },
    { label: "mid", n: 5, winRate: 20, avgPnlPct: -15 },
    { label: "high", n: 5, winRate: 45, avgPnlPct: 0 },
  ];
  const v = scoreCalibrationVerdict(summary);
  assert.equal(v.verdict, "SPREAD WITHOUT ORDER");
});

test("scoreCalibrationVerdict: monotonic DECREASING win rate by bucket -> INVERTED", () => {
  const summary = [
    { label: "low", n: 5, winRate: 75, avgPnlPct: 20 },
    { label: "mid", n: 5, winRate: 45, avgPnlPct: 0 },
    { label: "high", n: 5, winRate: 15, avgPnlPct: -20 },
  ];
  const v = scoreCalibrationVerdict(summary);
  assert.equal(v.verdict, "INVERTED");
});

test("scoreCalibrationVerdict: near-identical win rates across buckets -> FLAT, not a fabricated trend", () => {
  const summary = [
    { label: "low", n: 5, winRate: 40, avgPnlPct: -2 },
    { label: "mid", n: 5, winRate: 42, avgPnlPct: -1 },
    { label: "high", n: 5, winRate: 41, avgPnlPct: -1.5 },
  ];
  const v = scoreCalibrationVerdict(summary);
  assert.equal(v.verdict, "FLAT");
});

test("scoreCalibrationVerdict: buckets below minN are excluded and NAMED, not silently dropped", () => {
  const summary = [
    { label: "score 5-15", n: 2, winRate: 0, avgPnlPct: -30 },
    { label: "mid", n: 5, winRate: 40, avgPnlPct: -5 },
    { label: "high", n: 5, winRate: 80, avgPnlPct: 25 },
  ];
  const v = scoreCalibrationVerdict(summary, { minN: 3 });
  assert.equal(v.usableBuckets, 2);
  assert.equal(v.excluded.length, 1);
  assert.match(v.excluded[0], /score 5-15\(n=2\)/);
});

test("scoreCalibrationVerdict: fewer than 2 usable buckets -> INSUFFICIENT DATA, never a guessed verdict", () => {
  const summary = [{ label: "only", n: 10, winRate: 50, avgPnlPct: 0 }];
  const v = scoreCalibrationVerdict(summary);
  assert.equal(v.verdict, "INSUFFICIENT DATA");
});
