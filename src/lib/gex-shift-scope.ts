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
 * True when at least one of `expiries` has a real, finite value on this row — i.e. there is
 * something to diff, as opposed to `sumMetricCellsForExpiries` defaulting an absent row to 0.
 * Needed because a true "no data" row and a true "measured, net-zero" row both sum to 0, and
 * only this check can tell them apart.
 */
function hasScopedCoverage(
  row: Record<string, number> | undefined,
  expiries: readonly string[],
): boolean {
  if (!row) return false;
  return expiries.some((exp) => typeof row[exp] === "number" && Number.isFinite(row[exp]));
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
  const currentRow = cells[key];
  const baselineRow = baseline[key];
  // BUG FIX: this used to be `if (!Number.isFinite(d) || d === 0) return undefined`, which
  // treated a strike with NO data in this expiry scope (sum defaults to 0 on both sides) the
  // SAME as a strike with REAL data on both sides whose net change happens to be exactly zero —
  // the latter is a measured "no change", not an absence, but it rendered identically to "never
  // checked" (no DR% chip at all, same as a strike truly outside the baseline). The scoped and
  // unscoped lenses were also supposed to agree ("same % math as SPX Slayer") but didn't:
  // matrixShiftDeltaForStrike (unscoped, above) happily returns a real 0. One sibling call site
  // (ThermalCompactMatrix.tsx's `shiftDelta != null && shiftDelta >= 0` tone check) already
  // anticipates a legitimate zero reaching it — this function silently never let one through.
  // Only return undefined when there is genuinely nothing to diff on EITHER side.
  if (!hasScopedCoverage(currentRow, selectedExpiries) && !hasScopedCoverage(baselineRow, selectedExpiries)) {
    return undefined;
  }
  const d =
    sumMetricCellsForExpiries(currentRow, selectedExpiries) -
    sumMetricCellsForExpiries(baselineRow, selectedExpiries);
  return Number.isFinite(d) ? d : undefined;
}
