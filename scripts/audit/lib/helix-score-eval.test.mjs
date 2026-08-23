import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketForScore, gradeForward, summarizeByBucket, scoreSeparation, SCORE_BUCKETS,
  isEquityGradeable,
  partitionGradeable,
  ungradedTickers,
} from "./helix-score-eval.mjs";

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

const mk = (bucketScore, wins, losses) => [
  ...Array.from({ length: wins }, () => ({ score: bucketScore, premium: 1, graded: { win: true, favorablePct: 1 } })),
  ...Array.from({ length: losses }, () => ({ score: bucketScore, premium: 1, graded: { win: false, favorablePct: -1 } })),
];

test("a tight spread is FLAT regardless of ordering", () => {
  assert.equal(scoreSeparation(summarizeByBucket([...mk(60, 50, 50), ...mk(90, 52, 48)]), 30).verdict, "FLAT");
});

test("RANKS requires the win rate to TREND with the score, not merely differ", () => {
  // Monotonically rising across three buckets -> a real ranking.
  const r = scoreSeparation(summarizeByBucket([...mk(10, 40, 60), ...mk(50, 55, 45), ...mk(90, 70, 30)]), 30);
  assert.equal(r.verdict, "RANKS");
  assert.ok(r.rho > 0.9, `expected a strong positive trend, got rho=${r.rho}`);
  assert.equal(r.best.bucket, "85-100");
  assert.equal(r.worst.bucket, "0-19");
});

test("a BIG spread with SCRAMBLED ordering is not a ranking — the trap that prompted this", () => {
  // Zig-zag: 45 / 55 / 40 / 50 across rising score buckets. Spearman is exactly 0 — no trend at
  // all — while the spread is 15pp. An earlier version of this function called that "SEPARATES",
  // which would have contradicted the very write-up it was measuring for.
  const r = scoreSeparation(summarizeByBucket([
    ...mk(10, 45, 55),   // 0-19    45%
    ...mk(30, 55, 45),   // 20-39   55%  <- best
    ...mk(50, 40, 60),   // 40-59   40%  <- worst
    ...mk(90, 50, 50),   // 85-100  50%
  ]), 30);
  assert.ok(r.spreadPp > 10, "the spread really is large");
  assert.ok(Math.abs(r.rho) < 0.6, `ordering must read as no trend, got rho=${r.rho}`);
  assert.equal(r.verdict, "SPREAD WITHOUT ORDER", "a large spread with no trend must not read as a ranking");
});

test("the REAL 400-row run's shape does not read as a working score", () => {
  // Measured 2026-08-23 at +30min over 367 graded prints: 0-19 48.8%, 20-39 49.6%, 40-59 38.7%,
  // 60 53.8%. The best bucket is 20-39 and the worst is the MIDDLE one. Whatever label it lands on,
  // the one thing it must never be is RANKS — that is the claim the PR rests on.
  const r = scoreSeparation(summarizeByBucket([
    ...mk(10, 488, 512),
    ...mk(30, 496, 504),
    ...mk(50, 387, 613),
    ...mk(60, 538, 462),
  ]), 30);
  assert.notEqual(r.verdict, "RANKS", "a mid bucket worst and a low bucket best is not a ranking");
  assert.ok(r.spreadPp > 10, "and the spread alone would have looked like signal");
});

test("a score that ranks BACKWARDS is reported as INVERTED, not as working", () => {
  const r = scoreSeparation(summarizeByBucket([...mk(10, 70, 30), ...mk(50, 55, 45), ...mk(90, 40, 60)]), 30);
  assert.equal(r.verdict, "INVERTED");
  assert.ok(r.rho < -0.9);
});

test("tied win rates cannot masquerade as agreement", () => {
  // Three buckets all at exactly 50%: no spread, so FLAT — and averaged ranks keep rho from
  // reporting a trend that does not exist.
  const r = scoreSeparation(summarizeByBucket([...mk(10, 50, 50), ...mk(50, 50, 50), ...mk(90, 50, 50)]), 30);
  assert.equal(r.verdict, "FLAT");
  assert.equal(r.spreadPp, 0);
});

test("NON_EQUITY_ROOTS excludes cash-index roots and NOT SPY", () => {
  // Measured 2026-08-23 with the probe's own `fetchAggBars` call: SPY 893 bars, QQQ 923 bars;
  // SPX / SPXW / RUT / NDX / VIX / XSP all 0. SPY is an ETF in the equity namespace and grades
  // normally — sweeping it in with "index roots" would silently drop 79 gradeable live prints.
  assert.equal(isEquityGradeable("SPY"), true);
  assert.equal(isEquityGradeable("QQQ"), true);
  for (const root of ["SPX", "SPXW", "RUT", "NDX", "VIX", "XSP"]) {
    assert.equal(isEquityGradeable(root), false, `${root} must be excluded`);
  }
  assert.equal(isEquityGradeable("spxw"), false, "case must not decide gradeability");
});

test("partitionGradeable names what it dropped, with counts", () => {
  // The live composition: 160 index-root prints reached candidates, 81 of them ungradeable.
  const rows = [
    ...Array.from({ length: 61 }, () => ({ ticker: "SPXW" })),
    ...Array.from({ length: 18 }, () => ({ ticker: "SPX" })),
    ...Array.from({ length: 2 }, () => ({ ticker: "RUT" })),
    ...Array.from({ length: 79 }, () => ({ ticker: "SPY" })),
    ...Array.from({ length: 40 }, () => ({ ticker: "NVDA" })),
  ];
  const p = partitionGradeable(rows);
  assert.equal(p.excludedCount, 81);
  assert.equal(p.gradeable.length, 119, "SPY must survive the partition");
  // A bare "81 excluded" invites the reader to assume noise; the breakdown is checkable.
  assert.deepEqual(p.excludedByTicker, [["SPXW", 61], ["SPX", 18], ["RUT", 2]]);
});

test("partitionGradeable handles an empty population without inventing an exclusion", () => {
  const p = partitionGradeable([]);
  assert.equal(p.excludedCount, 0);
  assert.deepEqual(p.excludedByTicker, []);
});

test("ungradedTickers surfaces a root NON_EQUITY_ROOTS does not list", () => {
  // The backstop. If the list is incomplete, the unlisted root fetches nothing and would otherwise
  // just shrink the graded count — which reads as thin data, not as a symbol we cannot price.
  const graded = [
    ...Array.from({ length: 5 }, () => ({ ticker: "DJX", graded: null })),
    ...Array.from({ length: 4 }, () => ({ ticker: "NVDA", graded: "win" })),
    // one print that simply fell outside bar tolerance must NOT be reported as a dead ticker
    { ticker: "AMD", graded: null },
  ];
  assert.deepEqual(ungradedTickers(graded), [{ ticker: "DJX", prints: 5 }]);
});

test("ungradedTickers stays silent when every ticker graded something", () => {
  const graded = Array.from({ length: 6 }, (_, i) => ({ ticker: "NVDA", graded: i ? "win" : null }));
  assert.deepEqual(ungradedTickers(graded), []);
});
