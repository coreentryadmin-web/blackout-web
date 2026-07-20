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

function rowSum(
  cells: number[][] | Record<string, Record<string, number>>,
  strikeIdx: number,
  strikeStr: string,
  expiries: string[]
): number {
  if (Array.isArray(cells)) {
    return (cells[strikeIdx] ?? []).reduce((a, b) => a + (b ?? 0), 0);
  }
  const row = cells[strikeStr];
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
    const strikeStr = String(strike);
    const prevSum = rowSum(previous.gex, i, strikeStr, previous.expiries);
    const currSum = rowSum(current.gex, i, strikeStr, current.expiries);
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
