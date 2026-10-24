/**
 * Pure evaluation helpers for the Swing score-calibration reliability diagram (Night Hawk Swings
 * v6 outcome-driven mandate, item 3, 2026-09-10).
 *
 * THE QUESTION. v5 already asked "does score/origin predict BIG winners" (open, unmeasured). v6
 * sharpens it: does a play scored ~70 at commit actually WIN close to 70% of the time — i.e. is
 * `score` calibrated, not just correlated? A well-calibrated score is both monotonic (higher score
 * -> higher realized win rate) and roughly diagonal (the number itself is close to the realized
 * rate). This module only tests the monotonic half — the diagonal/Brier-style calibration question
 * needs enough per-bucket n to compare against an actual probability, which the swing population
 * (dozens of closed chains, not hundreds) cannot support yet; that's disclosed in the verdict, not
 * silently dropped.
 *
 * BUCKETING. Swing's total closed population (dozens, not Helix's hundreds) makes a literal
 * ten-way decile split dishonest — most buckets would round to n=2-3, indistinguishable from noise.
 * `chooseBucketCount` picks the largest bucket count (capped at 10, "decile" as an upper bound, not
 * a mandate) that still leaves each bucket with at least `minPerBucket` rows, and buckets by
 * QUANTILE (equal population count) rather than fixed score ranges, so a skewed score distribution
 * doesn't starve some buckets while overloading others. Both choices, and the resulting real bucket
 * count, are returned so a caller can never mistake "3 buckets" for "10 buckets, 7 thin."
 *
 * VERDICT LOGIC — copied in spirit from `helix-score-eval.mjs`'s hard-won lesson: a spread between
 * buckets is not evidence of a ranking (that tool's own history: a 10.9pp SCRAMBLED spread was once
 * mislabeled "SEPARATES"). RANKS requires both a real spread AND a monotonic (Spearman) trend by
 * bucket rank. Same four-way verdict shape: RANKS / SPREAD WITHOUT ORDER / INVERTED / FLAT, plus
 * INSUFFICIENT DATA when there aren't enough usable buckets to compute a correlation at all.
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */

/** Quantile-bucket a graded population by score. Returns rows tagged with their bucket index
 *  (0 = lowest scores), or null bucket for a row with no usable score — never coerced to 0. */
export function chooseBucketCount(n, { maxBuckets = 10, minPerBucket = 3 } = {}) {
  if (n < minPerBucket * 2) return 1;
  return Math.max(1, Math.min(maxBuckets, Math.floor(n / minPerBucket)));
}

/** @param {{score: number|null, pnlPct: number|null}[]} rows */
export function bucketByScoreQuantile(rows, opts = {}) {
  const usable = rows.filter((r) => typeof r.score === "number" && Number.isFinite(r.score) && typeof r.pnlPct === "number" && Number.isFinite(r.pnlPct));
  const bucketCount = chooseBucketCount(usable.length, opts);
  const sorted = [...usable].sort((a, b) => a.score - b.score);
  const buckets = Array.from({ length: bucketCount }, () => []);
  sorted.forEach((row, i) => {
    const idx = Math.min(bucketCount - 1, Math.floor((i / sorted.length) * bucketCount));
    buckets[idx].push(row);
  });
  return buckets.map((rowsInBucket, i) => {
    const n = rowsInBucket.length;
    const wins = rowsInBucket.filter((r) => r.pnlPct > 0).length;
    const scoreLo = n ? Math.min(...rowsInBucket.map((r) => r.score)) : null;
    const scoreHi = n ? Math.max(...rowsInBucket.map((r) => r.score)) : null;
    return {
      bucketIndex: i,
      label: n ? `score ${Math.round(scoreLo)}-${Math.round(scoreHi)}` : `bucket ${i}`,
      n,
      wins,
      winRate: n ? (wins / n) * 100 : null,
      avgPnlPct: n ? rowsInBucket.reduce((a, r) => a + r.pnlPct, 0) / n : null,
    };
  });
}

/** Same RANKS/SPREAD-WITHOUT-ORDER/INVERTED/FLAT/INSUFFICIENT-DATA shape as helix-score-eval.mjs's
 *  scoreSeparation, deliberately — this is the second product this exact question has been asked
 *  of, and the verdict discipline (spread AND monotonic trend both required for RANKS) is the part
 *  that must not drift between them. */
export function scoreCalibrationVerdict(summary, { minN = 3, spreadThresholdPp = 5, rhoThreshold = 0.6 } = {}) {
  const usable = summary.filter((s) => s.n >= minN && s.winRate != null);
  const excluded = summary.filter((s) => s.n < minN).map((s) => `${s.label}(n=${s.n})`);
  if (usable.length < 2) {
    return { verdict: "INSUFFICIENT DATA", usableBuckets: usable.length, excluded };
  }
  const rates = usable.map((s) => s.winRate);
  const spread = Math.max(...rates) - Math.min(...rates);

  const n = usable.length;
  const scoreRanks = usable.map((_, i) => i + 1);
  const sortedRates = [...rates].sort((a, b) => a - b);
  const rateRanks = rates.map((r) => {
    const first = sortedRates.indexOf(r);
    const last = sortedRates.lastIndexOf(r);
    return (first + last) / 2 + 1;
  });
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const ms = mean(scoreRanks), mr = mean(rateRanks);
  let num = 0, ds = 0, dr = 0;
  for (let i = 0; i < n; i++) {
    num += (scoreRanks[i] - ms) * (rateRanks[i] - mr);
    ds += (scoreRanks[i] - ms) ** 2;
    dr += (rateRanks[i] - mr) ** 2;
  }
  const rho = ds > 0 && dr > 0 ? num / Math.sqrt(ds * dr) : 0;

  const verdict =
    spread < spreadThresholdPp ? "FLAT"
      : rho >= rhoThreshold ? "RANKS"
        : rho <= -rhoThreshold ? "INVERTED"
          : "SPREAD WITHOUT ORDER";

  return {
    verdict,
    spreadPp: Math.round(spread * 10) / 10,
    rho: Math.round(rho * 1000) / 1000,
    best: usable.reduce((a, b) => (b.winRate > a.winRate ? b : a)),
    worst: usable.reduce((a, b) => (b.winRate < a.winRate ? b : a)),
    usableBuckets: n,
    excluded,
  };
}
