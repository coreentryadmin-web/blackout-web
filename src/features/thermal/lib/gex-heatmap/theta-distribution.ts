/**
 * Theta Distribution analysis — charm/time-decay concentration and pinning patterns.
 *
 * Charm (Θ-decay sensitivity) shows where dealer hedging drags/pins price via time decay:
 * - Positive CHARM: pins upward (dealers long gamma, long theta hedging pulls price up)
 * - Negative CHARM: drags downward (dealers short gamma, negative theta hedging pulls down)
 *
 * Traders use this to identify:
 * - Where time decay concentration creates support/resistance
 * - Which side (calls vs puts) owns the theta flow
 * - Pinning risk into expiry
 * - Premium decay opportunities for sellers
 */

import type { GexCells } from "./per-expiry-levels";

export type ThetaDistributionBucket = {
  strike: number;
  absCharm: number;
  charmSign: number; // raw signed charm for direction (positive=pin up, negative=pin down)
  pctOfTotal: number;
  rank: number;
  isConcentration: boolean; // >10% of total absolute charm
  isPinUp: boolean; // positive charm concentration
  isPinDown: boolean; // negative charm concentration
  isClustered: boolean; // within 2 strikes of a concentration strike
};

export type ThetaDistributionAnalysis = {
  buckets: ThetaDistributionBucket[];
  totalAbsCharm: number;
  netCharm: number; // signed sum showing net pin direction
  concentrationStrikes: number[];
  pinUpStrikes: number[]; // strikes with significant positive charm
  pinDownStrikes: number[]; // strikes with significant negative charm
  clusterCount: number;
  maxGap: number;
  gapStrikes: Array<{ from: number; to: number; gap: number }>;
  exposureSpread: number;
  pinBias: "up" | "down" | "neutral"; // which direction dominates
};

/**
 * Analyze the distribution of charm (theta-decay hedging) across strikes.
 * Identifies where premium decay creates support/resistance via dealer hedging.
 */
export function analyzeThetaDistribution(
  cells: GexCells,
  spot: number,
  bandPct = 0.03
): ThetaDistributionAnalysis {
  if (!cells || !(spot > 0) || !(bandPct > 0)) {
    return {
      buckets: [],
      totalAbsCharm: 0,
      netCharm: 0,
      concentrationStrikes: [],
      pinUpStrikes: [],
      pinDownStrikes: [],
      clusterCount: 0,
      maxGap: 0,
      gapStrikes: [],
      exposureSpread: 0,
      pinBias: "neutral",
    };
  }

  const lo = spot * (1 - bandPct);
  const hi = spot * (1 + bandPct);

  // Sum charm (signed) across all expiries for each strike in the band.
  const strikeTotals = new Map<number, number>();
  for (const [s, cols] of Object.entries(cells)) {
    const strike = Number(s);
    if (!Number.isFinite(strike) || strike < lo || strike > hi) continue;

    let strikeCharm = 0;
    for (const g of Object.values(cols ?? {})) {
      if (typeof g === "number" && Number.isFinite(g)) {
        strikeCharm += g;
      }
    }
    if (strikeCharm !== 0) {
      strikeTotals.set(strike, strikeCharm);
    }
  }

  if (strikeTotals.size === 0) {
    return {
      buckets: [],
      totalAbsCharm: 0,
      netCharm: 0,
      concentrationStrikes: [],
      pinUpStrikes: [],
      pinDownStrikes: [],
      clusterCount: 0,
      maxGap: 0,
      gapStrikes: [],
      exposureSpread: 0,
      pinBias: "neutral",
    };
  }

  const sorted = Array.from(strikeTotals.entries()).sort((a, b) => a[0] - b[0]);
  const totalAbsCharm = sorted.reduce((sum, [, charm]) => sum + Math.abs(charm), 0);
  const netCharm = sorted.reduce((sum, [, charm]) => sum + charm, 0);

  // Build buckets with rankings and concentration detection.
  let rank = 1;
  const buckets = sorted
    .map(([strike, charm]) => ({
      strike,
      absCharm: Math.abs(charm),
      charmSign: charm,
      pctOfTotal: totalAbsCharm > 0 ? (Math.abs(charm) / totalAbsCharm) * 100 : 0,
      rank: rank++,
      isConcentration: (Math.abs(charm) / totalAbsCharm) * 100 > 10,
      isPinUp: charm > 0 && (Math.abs(charm) / totalAbsCharm) * 100 > 5,
      isPinDown: charm < 0 && (Math.abs(charm) / totalAbsCharm) * 100 > 5,
      isClustered: false, // computed below
    }))
    .sort((a, b) => b.absCharm - a.absCharm)
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

  const pinUpStrikes = buckets.filter((b) => b.isPinUp).map((b) => b.strike);
  const pinDownStrikes = buckets.filter((b) => b.isPinDown).map((b) => b.strike);

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

  // Count clusters (groups of consecutive strikes with >5% absolute charm each).
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

  // Determine pinning bias (require >2x imbalance to avoid false neutrals).
  const upTotal = buckets.filter((b) => b.charmSign > 0).reduce((s, b) => s + b.charmSign, 0);
  const downTotal = buckets
    .filter((b) => b.charmSign < 0)
    .reduce((s, b) => s + Math.abs(b.charmSign), 0);
  let pinBias: "up" | "down" | "neutral" = "neutral";
  if (upTotal > downTotal * 2) pinBias = "up";
  else if (downTotal > upTotal * 2) pinBias = "down";

  return {
    buckets: buckets.sort((a, b) => a.strike - b.strike),
    totalAbsCharm,
    netCharm,
    concentrationStrikes,
    pinUpStrikes,
    pinDownStrikes,
    clusterCount,
    maxGap,
    gapStrikes,
    exposureSpread,
    pinBias,
  };
}
