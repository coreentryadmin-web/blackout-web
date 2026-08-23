import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketForScore, gradeForward, summarizeByBucket, scoreSeparation, SCORE_BUCKETS } from "./helix-score-eval.mjs";

test("buckets isolate the saturation point at exactly 60", () => {
  assert.equal(bucketForScore(59.9), "40-59");
  assert.equal(bucketForScore(60), "60 (saturated)");
  assert.equal(bucketForScore(60.5), "61-84");
  assert.equal(bucketForScore(100), "85-100");
  assert.equal(bucketForScore(0), "0-19");
  // Every bucket must be reachable, or the histogram silently hides a population.
  const reached = new Set([0, 25, 45, 60, 70, 90].map(bucketForScore));
  assert.equal(reached.size, SCORE_BUCKETS.length);
});

test("an unscoreable value is null, never bucketed as zero", () => {
  for (const bad of [null, undefined, Number.NaN, "x", -1, 101]) {
    assert.equal(bucketForScore(bad), null, `${String(bad)} must not fall into a bucket`);
  }
});

test("a bearish print that fell is a WIN — direction signs the outcome", () => {
  const bear = gradeForward("bearish", 100, 98);
  assert.ok(bear.win);
  assert.equal(Math.round(bear.favorablePct * 100) / 100, 2);
  assert.equal(Math.round(bear.changePct * 100) / 100, -2);

  const bull = gradeForward("bullish", 100, 98);
  assert.equal(bull.win, false);
  assert.equal(Math.round(bull.favorablePct * 100) / 100, -2);
});

test("an ungradeable print returns null rather than diluting a hit rate toward 50%", () => {
  assert.equal(gradeForward("undetermined", 100, 105), null);
  assert.equal(gradeForward("mixed", 100, 105), null);
  assert.equal(gradeForward("bullish", 0, 105), null, "a zero entry price cannot yield a percentage");
  assert.equal(gradeForward("bullish", 100, Number.NaN), null);
  assert.equal(gradeForward(null, 100, 105), null);
});

test("summarizeByBucket counts only graded rows and preserves bucket order", () => {
  const rows = [
    { score: 60, premium: 1_000_000, graded: { win: true, favorablePct: 1 } },
    { score: 60, premium: 3_000_000, graded: { win: false, favorablePct: -1 } },
    { score: 90, premium: 5_000_000, graded: { win: true, favorablePct: 4 } },
    { score: 60, premium: 9_000_000, graded: null },        // ungraded — must be skipped
    { score: null, premium: 1, graded: { win: true, favorablePct: 9 } }, // unbucketable — skipped
  ];
  const s = summarizeByBucket(rows);
  assert.deepEqual(s.map((x) => x.bucket), ["60 (saturated)", "85-100"]);
  const sat = s[0];
  assert.equal(sat.n, 2, "the ungraded row must not be counted");
  assert.equal(sat.wins, 1);
  assert.equal(sat.winRate, 50);
  assert.equal(sat.avgPremium, 2_000_000);
});

test("scoreSeparation refuses a verdict built on thin buckets, and names what it dropped", () => {
  const thin = summarizeByBucket([
    { score: 60, premium: 1, graded: { win: true, favorablePct: 1 } },
    { score: 90, premium: 1, graded: { win: false, favorablePct: -1 } },
  ]);
  const r = scoreSeparation(thin, 30);
  assert.equal(r.verdict, "INSUFFICIENT DATA");
  assert.ok(r.excluded.length >= 2, "the dropped buckets must be NAMED, not silently omitted");
  assert.match(r.excluded.join(" "), /n=1/);
});

test("scoreSeparation grades FLAT / WEAK / SEPARATES off the spread, not a coefficient", () => {
  const mk = (bucketScore, wins, losses) => [
    ...Array.from({ length: wins }, () => ({ score: bucketScore, premium: 1, graded: { win: true, favorablePct: 1 } })),
    ...Array.from({ length: losses }, () => ({ score: bucketScore, premium: 1, graded: { win: false, favorablePct: -1 } })),
  ];
  // 50% vs 52% -> FLAT
  assert.equal(scoreSeparation(summarizeByBucket([...mk(60, 50, 50), ...mk(90, 52, 48)]), 30).verdict, "FLAT");
  // 50% vs 57% -> WEAK
  assert.equal(scoreSeparation(summarizeByBucket([...mk(60, 50, 50), ...mk(90, 57, 43)]), 30).verdict, "WEAK");
  // 40% vs 70% -> SEPARATES
  const sep = scoreSeparation(summarizeByBucket([...mk(60, 40, 60), ...mk(90, 70, 30)]), 30);
  assert.equal(sep.verdict, "SEPARATES");
  assert.equal(sep.best.bucket, "85-100");
  assert.equal(sep.worst.bucket, "60 (saturated)");
  assert.ok(Math.abs(sep.spreadPp - 30) < 0.001);
});
