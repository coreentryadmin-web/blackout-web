import type { GexShiftLike } from "@/lib/gex-shift-leaders";
import { matrixShiftDeltaForStrike } from "@/lib/gex-shift-leaders";

/** Sum one strike's matrix cells over an expiry subset (DTE scope). */
export function sumMetricCellsForExpiries(
  row: Record<string, number> | undefined,
  expiries: readonly string[],
): number {
  if (!row) return 0;
  let sum = 0;
  for (const exp of expiries) {
    const v = row[exp];
    if (typeof v === "number" && Number.isFinite(v)) sum += v;
  }
  return sum;
}

/**
 * Per-strike shift Δ for matrix/profile DR% — scoped to selected expiries when narrowed.
 * Unscoped ("All" / near-term server totals): server `delta_by_strike` on full book.
 * Scoped (single DTE, 0DTE, near/monthly preset): diff current vs baseline cells for
 * ONLY those expiry columns (same % math as SPX Slayer, different book slice).
 */
export function matrixShiftDeltaForStrikeScoped(args: {
  shift: GexShiftLike | null | undefined;
  cells: Record<string, Record<string, number>>;
  selectedExpiries: string[] | null;
  strike: number;
}): number | undefined {
  const { shift, cells, selectedExpiries, strike } = args;
  if (selectedExpiries == null || selectedExpiries.length === 0) {
    return matrixShiftDeltaForStrike(shift, strike);
  }
  const baseline = shift?.baseline_cells;
  if (!baseline) return undefined;
  const key = String(strike);
  const d =
    sumMetricCellsForExpiries(cells[key], selectedExpiries) -
    sumMetricCellsForExpiries(baseline[key], selectedExpiries);
  if (!Number.isFinite(d) || d === 0) return undefined;
  return d;
}
