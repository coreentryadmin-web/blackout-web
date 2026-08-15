import {
  odteStrikeTotalsFromCells,
  recomputeScopedGexLevels,
} from "@/lib/correctness/gex-odte-scope";
import { shouldShowMatrixDriftPct } from "@/lib/gex-heatmap-display";
import { matrixShiftDeltaForStrikeScoped } from "@/lib/gex-shift-scope";
import type { GexShiftLike } from "@/lib/gex-shift-leaders";
import { fmtShiftPercentForStrike } from "@/features/thermal/lib/gex-heatmap/shift-math";
import type { GexHeatmapLens } from "@/lib/gex-heatmap-display";
import { rowsInBand } from "@/features/vector/lib/vector-ladder-align";

export type OdteMatrixRow = {
  strike: number;
  /** Signed net dealer gamma ($) for the 0DTE column. */
  value: number;
  shiftDelta: number | null;
  driftLabel: string | null;
  isKing: boolean;
  isCallWall: boolean;
  isPutWall: boolean;
};

export type OdteMatrixBuildInput = {
  strikes: readonly number[];
  cells: Record<string, Record<string, number>>;
  odteExpiry: string | null;
  spot: number | null;
  lens: GexHeatmapLens;
  shift: GexShiftLike | null | undefined;
  priceBand?: { min: number; max: number } | null;
};

export type OdteMatrixBuildResult = {
  rows: OdteMatrixRow[];
  spotIdx: number;
  peak: number;
  levels: ReturnType<typeof recomputeScopedGexLevels>;
};

function nearestStrikeIndex(strikes: readonly number[], spot: number | null): number {
  if (!strikes.length || spot == null || !Number.isFinite(spot)) return -1;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < strikes.length; i++) {
    const d = Math.abs(strikes[i]! - spot);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** Build strike rows for the Vector 0DTE matrix rail (gamma $ + intraday DR%). */
export function buildOdteMatrixRows(input: OdteMatrixBuildInput): OdteMatrixBuildResult {
  const { strikes, cells, odteExpiry, spot, lens, shift, priceBand } = input;
  const activeShift = shift;

  const banded = rowsInBand(
    strikes.map((strike) => ({ strike })),
    priceBand,
    0.15,
    { anchor: spot }
  ).map((r) => r.strike);

  const levels =
    lens === "gex" && odteExpiry
      ? recomputeScopedGexLevels(
          odteStrikeTotalsFromCells(cells, [...banded], odteExpiry),
          spot ?? 0
        )
      : { king: null, callWall: null, putWall: null, flip: null, netTotal: 0 };

  let peak = 0;
  const raw: OdteMatrixRow[] = banded.map((strike, si) => {
    const value =
      odteExpiry != null
        ? (cells[String(strike)]?.[odteExpiry] ?? 0)
        : 0;
    const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
    peak = Math.max(peak, Math.abs(n));
    const shiftDeltaRaw =
      odteExpiry != null
        ? matrixShiftDeltaForStrikeScoped({
            shift: activeShift,
            cells,
            selectedExpiries: [odteExpiry],
            strike,
          })
        : null;
    const shiftDelta = shiftDeltaRaw ?? null;
    const spotIdx = nearestStrikeIndex(banded, spot);
    const isSpotRow = si === spotIdx;
    const driftLabel =
      !isSpotRow && shouldShowMatrixDriftPct(si, spotIdx)
        ? fmtShiftPercentForStrike(n, shiftDelta)
        : null;

    return {
      strike,
      value: n,
      shiftDelta,
      driftLabel,
      isKing: lens === "gex" && levels.king != null && strike === levels.king,
      isCallWall: levels.callWall != null && strike === levels.callWall,
      isPutWall: levels.putWall != null && strike === levels.putWall,
    };
  });

  const spotIdx = nearestStrikeIndex(
    raw.map((r) => r.strike),
    spot
  );

  return { rows: raw, spotIdx, peak, levels };
}
