/**
 * Night Hawk Legacy Signal Intelligence, Phase 2E (started early — see header note below) —
 * empirical-Bayes shrinkage for small-sample rate displays. Direct answer to the operator's
 * standing mandate item #6: "Do not make strong conclusions from n=4 or n=11... Use Bayesian/
 * shrinkage-style calibration so a tiny sample cannot dramatically change the engine."
 *
 * WHY THIS EXISTS NOW rather than waiting for the rest of Phase 2E (the counterfactual harness):
 * Phase 2B part 1 (pull-rule-taxonomy.ts) just shipped `wrongly_rate_pct` per rule — and a rule
 * seen only 2-3 times can already show a "100% wrongly" or "0% wrongly" headline that reads as a
 * damning (or exonerating) verdict while being pure noise. This primitive is immediately
 * applicable to that number today, not blocked on new data accumulating the way Phase 2B part 2
 * (regime-based WHY-classification) and Phase 2C (winner-DNA) are — both need weeks of freshly-
 * shipped capture (market_regime, MFE/MAE) to build a real history against, so building THIS
 * first is the higher-leverage next step.
 *
 * METHOD: shrinks an observed rate toward a POOLED rate (the grand mean across every bucket in
 * the same breakdown — e.g. every pull rule's combined wrongly-rate) in proportion to how thin
 * that bucket's own n is, using the standard Beta-Binomial/James-Stein-style formula:
 *
 *   shrunk = (n * observed + priorStrength * pool) / (n + priorStrength)
 *
 * At n=0 this returns the pool rate exactly (no real information, no fabricated confidence in
 * the observed number). As n grows past priorStrength, the shrunk value converges toward the raw
 * observed rate — a large, real sample is allowed to actually move the number. priorStrength is
 * the "how many observations before we start trusting this bucket over the pool" knob, expressed
 * in the same units as n (an effective prior sample size), not a magic weight.
 */

/**
 * Shrinks one bucket's observed rate (as a %, 0-100) toward `poolRatePct` in proportion to `n`
 * vs `priorStrength`. `n <= 0` returns `poolRatePct` exactly (no data, no opinion of its own).
 * `priorStrength <= 0` returns `observedRatePct` unshrunk (an explicit "trust the raw number"
 * opt-out, never a divide-by-zero).
 */
export function shrinkRatePct(
  n: number,
  observedRatePct: number,
  poolRatePct: number,
  priorStrength: number
): number {
  if (!Number.isFinite(n) || n <= 0) return poolRatePct;
  if (!Number.isFinite(priorStrength) || priorStrength <= 0) return observedRatePct;
  const shrunk = (n * observedRatePct + priorStrength * poolRatePct) / (n + priorStrength);
  return Math.round(shrunk * 10) / 10;
}

/**
 * The pooled (grand-mean) rate across a set of buckets, weighted by each bucket's own n — the
 * natural `poolRatePct` input to `shrinkRatePct` for a same-shape breakdown (e.g. every pull
 * rule's wrongly/n pair). Null when every bucket has n=0 (no pool to shrink toward, never a
 * fabricated 0 or 50).
 */
export function pooledRatePct(buckets: Array<{ n: number; ratePct: number }>): number | null {
  let totalN = 0;
  let totalWeighted = 0;
  for (const b of buckets) {
    if (!Number.isFinite(b.n) || b.n <= 0) continue;
    totalN += b.n;
    totalWeighted += b.n * b.ratePct;
  }
  if (totalN === 0) return null;
  return Math.round((totalWeighted / totalN) * 10) / 10;
}
