import "server-only";

import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { sharedCacheGet } from "@/lib/shared-cache";
import { calculateMatrixDelta, type GexMatrix } from "@/lib/gex-matrix-delta";

export type GexMatrixChangesForLargo = {
  ticker: string;
  available: boolean;
  asof: string | null;
  spot: number | null;
  previous_asof: string | null;
  /** Material strike-level GEX shifts since the last warm snapshot (≥$100 notional). */
  updated_strikes: Array<{
    strike: number;
    gex_change: number;
    direction: "stronger" | "weaker" | "flipped";
  }>;
  /** Largest |change| strikes — the "wall building" candidates. */
  largest_moves: Array<{ strike: number; gex_change: number }>;
  spot_change: number | null;
  note: string | null;
};

function heatmapToMatrix(hm: NonNullable<Awaited<ReturnType<typeof fetchGexHeatmap>>>): GexMatrix {
  return {
    underlying: hm.underlying,
    spot: hm.spot,
    strikes: hm.strikes,
    expiries: hm.expiries,
    gex: hm.gex.cells,
    asof: hm.asof,
  };
}

/**
 * Sum one strike's GEX across expiries, from whichever matrix `cells` belongs to.
 *
 * BUG FIX (round 435): the array-cell-format branch used to take the CALLER's loop index
 * (derived from iterating `current.strikes`) and apply it directly to `cells` regardless of
 * which matrix it came from — including `previous.gex`, indexed by a position in
 * `current.strikes`. That is only correct when `previous.strikes[i] === current.strikes[i]`
 * for every `i`, which this function never verified. `polygon-options-gex.ts` builds the
 * strikes axis as a band AROUND SPOT (see its own comments on the ±6%/±20% band), so as spot
 * moves between two warm cron ticks the window can shift — one strike rolls off the low end,
 * a new one appears at the high end — keeping the same strike COUNT while the strike at a
 * given index changes. `rowSum(previous.gex, i, ...)` would then silently sum a DIFFERENT
 * strike's row than the one `strike` names, comparing mismatched strikes and reporting a
 * phantom "wall building" shift attributed to the wrong strike (or missing a real one).
 *
 * `src/lib/gex-matrix-delta.ts`'s own `getGexRow` had and fixed this EXACT bug (PR #7095,
 * "array-cell-format branch matched strikes by index, not value") — this file duplicates that
 * matrix-delta logic instead of reusing it, and the fix never made it across. Resolving the
 * array-format row by SEARCHING `ownStrikes` (the strikes array that actually belongs to the
 * `cells` being read) for `strike`, exactly like the record branch already does by key, closes
 * the same gap here: a strike absent from `ownStrikes` now honestly returns 0 (no data for that
 * strike in this snapshot) instead of silently reading an unrelated row.
 */
function rowSum(
  cells: number[][] | Record<string, Record<string, number>>,
  ownStrikes: number[],
  strike: number,
  expiries: string[]
): number {
  if (Array.isArray(cells)) {
    const idx = ownStrikes.indexOf(strike);
    return idx >= 0 ? (cells[idx] ?? []).reduce((a, b) => a + (b ?? 0), 0) : 0;
  }
  const row = cells[String(strike)];
  if (!row) return 0;
  return expiries.reduce((s, exp) => s + (row[exp] ?? 0), 0);
}

/** Compare current Thermal matrix vs last cron snapshot — wall build / material shift detection. */
export async function gexMatrixChangesForLargo(
  ticker: string,
  opts?: { limit?: number }
): Promise<GexMatrixChangesForLargo> {
  const sym = String(ticker ?? "").trim().toUpperCase();
  const limit = Math.min(30, Math.max(5, opts?.limit ?? 15));

  const currentHm = await fetchGexHeatmap(sym).catch(() => null);
  if (!currentHm?.strikes?.length) {
    return {
      ticker: sym,
      available: false,
      asof: null,
      spot: null,
      previous_asof: null,
      updated_strikes: [],
      largest_moves: [],
      spot_change: null,
      note: "Matrix cold — no shared heatmap cache for this ticker.",
    };
  }

  const current = heatmapToMatrix(currentHm);
  const previous = await sharedCacheGet<GexMatrix>(`gex-matrix-snapshot:${sym}`).catch(() => null);

  if (!previous) {
    return {
      ticker: sym,
      available: true,
      asof: current.asof,
      spot: current.spot,
      previous_asof: null,
      updated_strikes: [],
      largest_moves: [],
      spot_change: null,
      note: "No prior snapshot yet — first warm cycle will establish baseline.",
    };
  }

  const delta = calculateMatrixDelta(previous, current);
  const moves: GexMatrixChangesForLargo["updated_strikes"] = [];

  for (let i = 0; i < current.strikes.length; i++) {
    const strike = current.strikes[i]!;
    const prevSum = rowSum(previous.gex, previous.strikes, strike, previous.expiries);
    const currSum = rowSum(current.gex, current.strikes, strike, current.expiries);
    const gex_change = currSum - prevSum;
    if (Math.abs(gex_change) < 100) continue;

    const direction: "stronger" | "weaker" | "flipped" =
      prevSum === 0 || currSum === 0
        ? "flipped"
        : Math.sign(prevSum) === Math.sign(currSum)
          ? Math.abs(currSum) > Math.abs(prevSum)
            ? "stronger"
            : "weaker"
          : "flipped";

    moves.push({ strike, gex_change, direction });
  }

  moves.sort((a, b) => Math.abs(b.gex_change) - Math.abs(a.gex_change));

  return {
    ticker: sym,
    available: true,
    asof: current.asof,
    spot: current.spot,
    previous_asof: previous.asof,
    updated_strikes: moves.slice(0, limit),
    largest_moves: moves.slice(0, 8).map((m) => ({ strike: m.strike, gex_change: m.gex_change })),
    spot_change: current.spot - previous.spot,
    note: delta
      ? `${delta.updated_strikes.length} strike(s) moved ≥$100 notional since last warm.`
      : "Spot moved but no strike exceeded the change threshold.",
  };
}
