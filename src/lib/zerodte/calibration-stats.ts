// 0DTE calibration statistics helpers (Hardening WS-09) — the small, pure, dependency-
// free stats kernel the calibration analyzer (./calibration.ts) leans on to attach
// HONEST uncertainty to every win-rate bucket instead of a bare point estimate.
//
// Why this exists. Every bucket in calibration.ts is a binomial proportion (wins / n)
// over a SMALL sample — the whole module's discipline is "never let a 2-sample bucket
// read like a track record". A raw win_rate_pct hides that: 8/10 and 80/100 both print
// "80%" while meaning wildly different things. The Wilson score interval makes the
// sample size visible in the number itself (a tight CI at n=100, a huge one at n=10),
// which is exactly the input the graduation ladder needs to require a LOWER-BOUND that
// clears a floor rather than a fragile point estimate. Pure functions only — no clock,
// no IO, no domain types — so they are trivially unit-testable and reusable by both the
// 0DTE and swing calibration lanes.
//
// All intervals are computed and returned in PROPORTION units [0,1]; callers that display
// percentages scale by 100 at the edge. z defaults to 1.96 (≈95% two-sided normal).

/** A proportion interval in [0,1]. `mid` is the interval's center point (Wilson-adjusted,
 *  NOT the raw k/n) — null only when n=0 (no observation to center on). */
export type ProportionInterval = { lo: number; hi: number; mid: number | null };

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Wilson score interval for a binomial proportion (k successes in n trials).
 *
 * The Wilson interval is the standard small-sample-safe confidence interval for a
 * proportion — unlike the naive Wald interval (p ± z·√(p(1−p)/n)) it does NOT collapse
 * to a zero-width, nonsensical interval at p=0 or p=1, and it stays inside [0,1] by
 * construction. That robustness at the extremes and at small n is precisely why it is
 * the right tool for calibration buckets, which routinely sit at 8/10 or 0/6.
 *
 *   center = (p + z²/2n) / (1 + z²/n)
 *   margin = (z / (1 + z²/n)) · √( p(1−p)/n + z²/4n² )
 *
 * n=0 → the uninformative [0,1] with a null center (no data to locate the interval).
 * Reference check: k=8, n=10, z=1.96 → ≈[0.490, 0.943] (pinned in the test).
 */
export function wilsonInterval(k: number, n: number, z = 1.96): ProportionInterval {
  if (n <= 0) return { lo: 0, hi: 1, mid: null };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { lo: clamp01(center - margin), hi: clamp01(center + margin), mid: clamp01(center) };
}

/** Prior pseudo-counts for the Bayesian posterior. Default = Jeffreys prior Beta(0.5,0.5),
 *  the standard non-informative prior for a binomial proportion (invariant, and — unlike a
 *  flat Beta(1,1) — it does not over-shrink extreme sparse cells toward 0.5). */
export type BetaPrior = { a: number; b: number };
export const JEFFREYS_PRIOR: BetaPrior = { a: 0.5, b: 0.5 };

/** A Bayesian posterior summary for a sparse binomial cell. `mean` is the exact posterior
 *  mean; `lo`/`hi` are an APPROXIMATE equal-tailed credible interval (normal approximation
 *  to the Beta posterior — see below). All in proportion units [0,1]. */
export type BetaPosterior = { mean: number; lo: number; hi: number };

/**
 * Beta-binomial posterior for k successes in n trials under a Beta prior (default Jeffreys).
 * Posterior is Beta(a+k, b+n−k); the mean is exact. The credible interval is the NORMAL
 * APPROXIMATION to that Beta (mean ± z·√var, clamped to [0,1]) — a deliberate, documented
 * approximation: a numerically-exact Beta quantile needs an inverse regularized incomplete
 * beta, which is far more machinery than a recommend-only calibration report warrants. The
 * approximation is tightest exactly where it is used (sparse cells the Wilson interval already
 * flags as low-n), and it is offered as SUPPLEMENTARY shrinkage evidence — the graduation
 * ladder gates on the Wilson lower bound, never on this posterior. z defaults to 1.96 (≈95%).
 */
export function betaBinomialPosterior(
  k: number,
  n: number,
  prior: BetaPrior = JEFFREYS_PRIOR,
  z = 1.96
): BetaPosterior {
  const a = prior.a + k;
  const b = prior.b + (n - k);
  const mean = a / (a + b);
  const variance = (a * b) / ((a + b) * (a + b) * (a + b + 1));
  const margin = z * Math.sqrt(variance);
  return { mean, lo: clamp01(mean - margin), hi: clamp01(mean + margin) };
}

/** The signed difference of two proportions (pLater − pEarlier) with a confidence interval.
 *  `diff`/`lo`/`hi` are in proportion units (so `diff` ranges [−1,1]). */
export type ProportionDiff = { diff: number; lo: number; hi: number };

/**
 * Confidence interval for the DIFFERENCE of two independent binomial proportions,
 * (kLater/nLater) − (kEarlier/nEarlier) — the out-of-sample decay metric (WS-09 forward
 * holdout). Uses the standard Wald interval for a difference of proportions:
 *
 *   diff = pL − pE,   SE = √( pE(1−pE)/nE + pL(1−pL)/nL ),   CI = diff ± z·SE
 *
 * When EITHER partition is empty there is no comparison to make, so this returns the
 * maximally-uninformative diff=0, lo=−1, hi=1 rather than dividing by zero — the caller
 * treats that as "cannot assess decay".
 *
 * SIGNIFICANCE READING (used by the graduation ladder): a *significant* decay means Later
 * is genuinely worse than Earlier, i.e. the whole CI sits below 0 (hi < 0). "No significant
 * decay" is therefore hi ≥ 0 — we cannot conclude the later period degraded.
 */
export function proportionDiffCI(
  kEarlier: number,
  nEarlier: number,
  kLater: number,
  nLater: number,
  z = 1.96
): ProportionDiff {
  if (nEarlier <= 0 || nLater <= 0) return { diff: 0, lo: -1, hi: 1 };
  const pE = kEarlier / nEarlier;
  const pL = kLater / nLater;
  const diff = pL - pE;
  const se = Math.sqrt((pE * (1 - pE)) / nEarlier + (pL * (1 - pL)) / nLater);
  const margin = z * se;
  return { diff, lo: Math.max(-1, diff - margin), hi: Math.min(1, diff + margin) };
}
