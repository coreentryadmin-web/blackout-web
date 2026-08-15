import { resolveOdteExpiry } from "@/lib/correctness/gex-odte-scope";
import {
  expiriesForHorizon,
  type VectorDteHorizon,
} from "@/features/vector/lib/vector-dte-horizon";

/** Expiries included in the matrix rail for the chart's DTE horizon. */
export function matrixScopeExpiries(
  expiries: readonly string[],
  horizon: VectorDteHorizon,
  todayYmd: string
): string[] {
  if (horizon === "0dte") {
    const odte = resolveOdteExpiry([...expiries], todayYmd);
    if (odte) return [odte];
  }
  return expiriesForHorizon(expiries, horizon, todayYmd);
}

/** Sum dealer gamma across all expiries in the active matrix scope for one strike. */
export function matrixCellValueForScope(
  cells: Record<string, Record<string, number>>,
  strike: number,
  scopeExpiries: readonly string[]
): number {
  const row = cells[String(strike)];
  if (!row || !scopeExpiries.length) return 0;
  let sum = 0;
  for (const exp of scopeExpiries) {
    const v = row[exp];
    if (typeof v === "number" && Number.isFinite(v)) sum += v;
  }
  return sum;
}

/** Per-strike totals summed across every expiry in the active matrix scope. */
export function strikeTotalsForScope(
  cells: Record<string, Record<string, number>>,
  strikes: readonly number[],
  scopeExpiries: readonly string[]
): Record<string, number> {
  if (!scopeExpiries.length || !strikes.length) return {};
  const out: Record<string, number> = {};
  for (const strike of strikes) {
    out[String(strike)] = matrixCellValueForScope(cells, strike, scopeExpiries);
  }
  return out;
}

/** Matrix rail title — honest about scope when the chart is not on 0DTE. */
export function matrixRailTitle(horizon: VectorDteHorizon): string {
  return horizon === "0dte" ? "0DTE Matrix" : `${horizon === "weekly" ? "Weekly" : horizon === "monthly" ? "Monthly" : "All"} Matrix`;
}
