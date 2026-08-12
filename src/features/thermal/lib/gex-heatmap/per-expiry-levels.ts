/**
 * Per-expiry Key Levels for the Thermal matrix.
 *
 * WHY THIS EXISTS. The Key Levels row was scoped INCONSISTENTLY and said so in a footnote rather
 * than fixing it:
 *
 *   Gamma Flip · Call Wall · Put Wall · Net GEX · King Node -> near-term AGGREGATE (all expiries)
 *   Max Pain                                                -> a SINGLE expiry (today's OI only)
 *
 * So six tiles that read as one coherent picture were describing two different books. Concretely:
 * a 0DTE trader reads `call wall 780` as today's resistance, but if today's expiry carries a small
 * share of the near-spot gamma, 780 is mostly Friday's wall and today's is somewhere else. The
 * blend hides exactly the thing that matters — whether today's expiry has enough gamma to pin at
 * all, or whether dealers are already positioned around the next one.
 *
 * Everything here is derived from `gex.cells` (strike -> expiry -> net dealer $-gamma), which the
 * payload ALREADY ships. No new fetch, no new server field, for the four gamma-derived tiles.
 * (Max Pain is the exception — it needs OI, not gamma, so it comes from the server per expiry.)
 *
 * Pure and client-safe: the only import is the dependency-free cross-validation core, so the walls
 * and flip are computed by the SAME functions the server uses for the aggregate. Re-deriving them
 * here would let the per-expiry and aggregate numbers drift apart, which is the bug this module is
 * fixing, one level down.
 */
import {
  cumulativeGammaFlip,
  gexWallsFromStrikeTotals,
} from "@/lib/providers/gex-cross-validation-core";

/** `gex.cells` as served: strike key -> expiry key -> net dealer dollar-gamma. */
export type GexCells = Record<string, Record<string, number>>;

export type ExpiryLevels = {
  /** Largest positive net-gamma strike within this expiry (resistance/pin). */
  callWall: number | null;
  /** Largest negative net-gamma strike within this expiry (support). */
  putWall: number | null;
  /** Cumulative zero-gamma boundary within this expiry. */
  flip: number | null;
  /** Signed net dealer dollar-gamma summed across this expiry's strikes. */
  netGex: number;
  /** Strike carrying the largest |net gamma| — this expiry's dominant node. */
  kingNode: number | null;
  /** Strikes with a non-zero reading. 0 means the expiry column is empty. */
  strikes: number;
};

/**
 * Collapse `cells` to one expiry's `strike -> netGamma` map.
 *
 * Strikes absent from that expiry are OMITTED rather than zero-filled: a strike with no contracts
 * at this expiry is not a strike with zero gamma, and zero-filling would make `kingNode` and the
 * wall scan treat "no data" as "balanced book".
 */
export function strikeTotalsForExpiry(cells: GexCells, expiry: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (!cells || !expiry) return out;
  for (const [strike, byExpiry] of Object.entries(cells)) {
    const g = byExpiry?.[expiry];
    if (typeof g === "number" && Number.isFinite(g) && g !== 0) out[strike] = g;
  }
  return out;
}

/** Every Key Levels value for ONE expiry, using the server's own wall/flip math. */
export function levelsForExpiry(cells: GexCells, expiry: string, spot: number): ExpiryLevels {
  const totals = strikeTotalsForExpiry(cells, expiry);
  const entries = Object.entries(totals);
  const { callWall, putWall } = gexWallsFromStrikeTotals(totals);

  let netGex = 0;
  let kingNode: number | null = null;
  let maxAbs = 0;
  for (const [s, g] of entries) {
    netGex += g;
    const a = Math.abs(g);
    if (a > maxAbs) {
      maxAbs = a;
      const strike = Number(s);
      kingNode = Number.isFinite(strike) ? strike : kingNode;
    }
  }

  return {
    callWall,
    putWall,
    // `cumulativeGammaFlip` needs a spot to walk out from; without one there is no flip to report
    // and a fabricated number would be worse than a dash.
    flip: spot > 0 && entries.length > 0 ? cumulativeGammaFlip(totals, spot) : null,
    netGex,
    kingNode,
    strikes: entries.length,
  };
}

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
