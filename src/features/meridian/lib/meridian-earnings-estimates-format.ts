/**
 * Pure formatting helpers for `MeridianEarningsEstimatesPanel.tsx` (EPS/revenue trajectory +
 * price-target rail). Extracted to a plain `.ts` sibling — same CI constraint as every other
 * component-local formatter in this repo (no render harness for a client component under the
 * plain node test runner) — so this logic can be unit-tested directly.
 *
 * The revenue formatter (`fmtMoney` in the original component) is now the shared
 * `fmtCompactRevenue` in `meridian-revenue-format.ts` — see that file's header for the
 * round-400 K→M→B unit-boundary fix it carries (this panel was one of two live duplicates of
 * the same bug, re-exported here for a minimal import diff at the one real call site).
 */
export { fmtCompactRevenue as fmtMoney } from "./meridian-revenue-format";

/** Bare EPS figure, e.g. "1.42" / "-0.08" — no unit tier, nothing to overflow. */
export function fmtEps(n: number): string {
  return n.toFixed(2);
}

/** Fiscal period label for a print_history/earnings_calendar row, e.g. "Q3 '26". */
export function period(row: {
  fiscal_period?: string | null;
  fiscal_year?: number | null;
  report_date?: string | null;
}): string {
  if (row.fiscal_period) {
    return row.fiscal_year ? `${row.fiscal_period} '${String(row.fiscal_year).slice(-2)}` : row.fiscal_period;
  }
  return row.report_date?.slice(2) ?? "—";
}
