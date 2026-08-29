/**
 * Greeks Distribution analysis — concentration risk, clustering patterns, and gap identification.
 *
 * Shows where gamma (and other Greeks) cluster vs scatter, helping traders identify:
 * - Concentration risk (single strike dominates)
 * - Clustering (multiple strikes tightly grouped)
 * - Gaps (wide stretches with little exposure)
 * - Expiry dominance (one maturity owns most of the exposure)
 */

import type { GexCells } from "./per-expiry-levels";

export type GreeksDistributionBucket = {
  strike: number;
  absGamma: number;
  pctOfTotal: number;
  rank: number;
  isConcentration: boolean; // >10% of total
  isClustered: boolean; // within 2 strikes of a concentration strike
};

export type GreeksDistributionAnalysis = {
  buckets: GreeksDistributionBucket[];
  totalAbsGamma: number;
  concentrationStrikes: number[]; // strikes with >10% exposure
  clusterCount: number; // number of tightly grouped regions
  maxGap: number; // largest gap between consecutive strikes with exposure
  gapStrikes: Array<{ from: number; to: number; gap: number }>;
  exposureSpread: number; // % difference between least and most exposed strikes in top 10
};

/**
 * Analyze the distribution of gamma across strikes in the near-spot band.
 * Helps identify concentration risk, clustering, and gaps.
 */
export function analyzeGreeksDistribution(
  cells: GexCells,
  spot: number,
  bandPct = 0.03,
  lens: "absolute" = "absolute"
): GreeksDistributionAnalysis {
  if (!cells || !(spot > 0) || !(bandPct > 0)) {
    return {
      buckets: [],
      totalAbsGamma: 0,
      concentrationStrikes: [],
      clusterCount: 0,
      maxGap: 0,
      gapStrikes: [],
      exposureSpread: 0,
    };
  }

  const lo = spot * (1 - bandPct);
  const hi = spot * (1 + bandPct);

  // Sum gamma across all expiries for each strike in the band.
  const strikeTotals = new Map<number, number>();
  for (const [s, cols] of Object.entries(cells)) {
    const strike = Number(s);
    if (!Number.isFinite(strike) || strike < lo || strike > hi) continue;

    let strikeGamma = 0;
    for (const g of Object.values(cols ?? {})) {
      if (typeof g === "number" && Number.isFinite(g)) {
        strikeGamma += Math.abs(g);
      }
    }
    if (strikeGamma > 0) {
      strikeTotals.set(strike, strikeGamma);
    }
  }

  if (strikeTotals.size === 0) {
    return {
      buckets: [],
      totalAbsGamma: 0,
      concentrationStrikes: [],
      clusterCount: 0,
      maxGap: 0,
      gapStrikes: [],
      exposureSpread: 0,
    };
  }

  const sorted = Array.from(strikeTotals.entries()).sort((a, b) => a[0] - b[0]);
  const totalAbsGamma = sorted.reduce((sum, [, g]) => sum + g, 0);
  const totalGamma = totalAbsGamma;

  // Build buckets with rankings and concentration detection.
  let rank = 1;
  const buckets = sorted
    .map(([strike, gamma]) => ({
      strike,
      absGamma: gamma,
      pctOfTotal: totalGamma > 0 ? (gamma / totalGamma) * 100 : 0,
      rank: rank++,
      isConcentration: (gamma / totalGamma) * 100 > 10,
      isClustered: false, // computed below
    }))
    .sort((a, b) => b.absGamma - a.absGamma)
    .map((bucket, idx) => ({ ...bucket, rank: idx + 1 }));

  // Mark strikes as clustered if they're within 2 strikes of a concentration strike.
  const concentrationStrikes = buckets.filter((b) => b.isConcentration).map((b) => b.strike);
  const strikeArray = buckets.map((b) => b.strike);
  buckets.forEach((bucket) => {
    if (bucket.isConcentration) bucket.isClustered = true;
    else {
      const idx = strikeArray.indexOf(bucket.strike);
      if (
        concentrationStrikes.some((cs) => Math.abs(strikeArray.indexOf(cs) - idx) <= 2)
      ) {
        bucket.isClustered = true;
      }
    }
  });

  // Identify gaps (stretches with little exposure).
  const gapStrikes: Array<{ from: number; to: number; gap: number }> = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1][0] - sorted[i][0];
    if (gap > 5) {
      gapStrikes.push({
        from: sorted[i][0],
        to: sorted[i + 1][0],
        gap,
      });
    }
  }

  const maxGap = gapStrikes.length > 0 ? Math.max(...gapStrikes.map((g) => g.gap)) : 0;

  // Count clusters (groups of consecutive strikes with >5% each).
  let clusterCount = 0;
  let inCluster = false;
  for (const bucket of buckets) {
    if (bucket.pctOfTotal > 5) {
      if (!inCluster) clusterCount++;
      inCluster = true;
    } else {
      inCluster = false;
    }
  }

  // Exposure spread among top 10.
  const top10 = buckets.slice(0, Math.min(10, buckets.length));
  const exposureSpread =
    top10.length > 1
      ? ((Math.max(...top10.map((b) => b.pctOfTotal)) -
          Math.min(...top10.map((b) => b.pctOfTotal))) /
          Math.max(...top10.map((b) => b.pctOfTotal))) *
        100
      : 0;

  return {
    buckets: buckets.sort((a, b) => a.strike - b.strike),
    totalAbsGamma,
    concentrationStrikes,
    clusterCount,
    maxGap,
    gapStrikes,
    exposureSpread,
  };
}
