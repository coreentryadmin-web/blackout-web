/**
 * Pure calibration helpers — "does a stated score predict the realized outcome?"
 *
 * Built for SPX Slayer's `confidence`, but the shape is generic: bucket a stated entry-time score
 * against realized win/loss, and report each bucket WITH ITS DENOMINATOR.
 *
 * THE TRAP THIS ENCODES. A score with ZERO VARIANCE is not "uncorrelated" — it is uninformative,
 * and the two must not be reported the same way. A Pearson/point-biserial correlation over a
 * constant is 0/0; naive code prints `NaN`, and a reader skims that as "no signal found" when the
 *real finding is "the input never varies". `correlate()` therefore returns a DEGENERATE verdict
 * rather than a number, and the caller must say so out loud.
 */

/** Mean of a numeric array. Empty → null, never 0 (0 is a measurement). */
export function mean(xs) {
  if (!xs.length) return null;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

export function stdev(xs) {
  const m = mean(xs);
  if (m == null) return null;
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length);
}

/**
 * Point-biserial correlation between a continuous predictor and a binary outcome.
 *
 * Returns `{ verdict: "ok", r }`, or a degenerate verdict naming WHICH side was constant — because
 * "the predictor never varies" and "the outcome never varies" are different facts with different
 * remedies, and neither is "r = 0".
 */
export function correlate(xs, ys) {
  if (xs.length !== ys.length) throw new Error("correlate: length mismatch");
  if (xs.length < 2) return { verdict: "insufficient_sample", n: xs.length };
  const sx = stdev(xs);
  const sy = stdev(ys);
  if (sx === 0 && sy === 0) return { verdict: "degenerate_both", n: xs.length };
  if (sx === 0) return { verdict: "degenerate_predictor", n: xs.length, constant: xs[0] };
  if (sy === 0) return { verdict: "degenerate_outcome", n: xs.length, constant: ys[0] };
  const mx = mean(xs);
  const my = mean(ys);
  const cov = mean(xs.map((v, i) => (v - mx) * (ys[i] - my)));
  return { verdict: "ok", n: xs.length, r: cov / (sx * sy) };
}

/**
 * Bucket rows by a predictor and report realized win rate per bucket.
 *
 * Every bucket carries `n`. A rate without its denominator is not a fact, and a bucket under
 * `minSample` is flagged `insufficient_sample` rather than being quietly rendered as a percentage
 * a reader will act on.
 */
export function bucketCalibration(rows, { value, isWin, buckets, minSample = 10 }) {
  return buckets.map(([lo, hi]) => {
    const inB = rows.filter((r) => {
      const v = value(r);
      return Number.isFinite(v) && v >= lo && v <= hi;
    });
    const wins = inB.filter(isWin).length;
    return {
      lo,
      hi,
      n: inB.length,
      wins,
      win_rate: inB.length ? wins / inB.length : null,
      insufficient_sample: inB.length < minSample,
    };
  });
}

/**
 * Does the predictor carry ANY information at all? Distinct from "is it well calibrated".
 * `distinct_values === 1` is the finding that a stated per-item score is really a constant.
 */
export function informationCheck(values) {
  const finite = values.filter((v) => Number.isFinite(v));
  const distinct = new Set(finite);
  return {
    n: finite.length,
    distinct_values: distinct.size,
    constant: distinct.size === 1 ? [...distinct][0] : null,
    uninformative: distinct.size <= 1,
  };
}
