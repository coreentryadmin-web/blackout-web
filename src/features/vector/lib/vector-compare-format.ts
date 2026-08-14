/** Spot readout for compare pane headers — SPX gets 2dp like the rest of the desk. */
export function fmtCompareSpot(spot: number | null, ticker: string): string {
  if (spot == null || !Number.isFinite(spot)) return "—";
  const digits = ticker === "SPX" || spot >= 1000 ? 2 : spot >= 100 ? 2 : 2;
  return spot.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
