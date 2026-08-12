/**
 * The PIN CONTEST — each expiry's share of the near-spot dealer gamma.
 *
 * Deliberately the ONLY thing in this module. Per-expiry walls / flip / net GEX are already
 * derived in GexHeatmap by `filterStrikeTotals` + `recomputeLevels` (they drive the profile and
 * curve); adding a second implementation here would have made a THIRD copy of the wall scan in a
 * codebase that already had two. Those existing helpers are now wired to the Key Levels row
 * instead, and the shared scan lives in `gexWallsFromStrikeTotals`.
 *
 * What was genuinely missing is this: WHICH expiry owns the gamma near spot. That is the number
 * the "will today's expiry pin, or have dealers moved on to the next one" question turns on — not
 * where each expiry's max pain sits. On the Thursday before monthly OpEx today's max pain can look
 * perfectly reasonable while today's expiry holds a fifth of the near-spot gamma and pins nothing.
 *
 * Pure and client-safe; derived from `gex.cells`, which the payload already ships.
 */

/** `gex.cells` as served: strike key -> expiry key -> net dealer dollar-gamma. */
export type GexCells = Record<string, Record<string, number>>;

export type ExpiryGammaShare = {
  expiry: string;
  /** |net gamma| within the near-spot band for this expiry. */
  absGamma: number;
  /** This expiry's fraction of the total near-spot |gamma| across all expiries, 0-1. */
  share: number;
};

/**
 * Each expiry's share of the NEAR-SPOT dealer gamma — the pin contest.
 *
 * This is the number that actually answers "will today's expiry pin, or have dealers moved on to
 * the next one". Pin force comes from gamma concentrated near spot at THAT expiry, not from where
 * its max pain happens to sit: on the Thursday before monthly OpEx, today's max pain can look
 * perfectly reasonable while today's expiry holds a fifth of the gamma and pins nothing.
 *
 * Banded around spot (default ±3%) because far-strike gamma does not pin the tape — including it
 * would let a fat, distant OpEx strike dominate the share and invert the reading.
 *
 * Returned sorted by expiry ascending. Shares sum to 1 when any gamma is in band, else all 0.
 */
export function gammaShareByExpiry(
  cells: GexCells,
  spot: number,
  bandPct = 0.03
): ExpiryGammaShare[] {
  const byExpiry = new Map<string, number>();
  if (!cells || !(spot > 0) || !(bandPct > 0)) return [];

  const lo = spot * (1 - bandPct);
  const hi = spot * (1 + bandPct);

  for (const [s, cols] of Object.entries(cells)) {
    const strike = Number(s);
    if (!Number.isFinite(strike) || strike < lo || strike > hi) continue;
    for (const [expiry, g] of Object.entries(cols ?? {})) {
      if (typeof g !== "number" || !Number.isFinite(g)) continue;
      byExpiry.set(expiry, (byExpiry.get(expiry) ?? 0) + Math.abs(g));
    }
  }

  const total = [...byExpiry.values()].reduce((a, b) => a + b, 0);
  return [...byExpiry.entries()]
    .map(([expiry, absGamma]) => ({
      expiry,
      absGamma,
      share: total > 0 ? absGamma / total : 0,
    }))
    .sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0));
}
