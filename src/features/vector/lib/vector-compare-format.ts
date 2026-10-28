/** Spot readout for compare pane headers — SPX gets 2dp like the rest of the desk. */
export function fmtCompareSpot(spot: number | null, ticker: string): string {
  if (spot == null || !Number.isFinite(spot)) return "—";
  const digits = ticker === "SPX" || spot >= 1000 ? 2 : spot >= 100 ? 2 : 2;
  // Locale pinned to "en-US" — every sibling price formatter in this desk (helix-flow-format,
  // vector-technicals, vector-play-engine, etc.) pins "en-US" explicitly; `undefined` here would
  // format using the viewer's browser locale, which flips the grouping/decimal separator meaning
  // (e.g. "1.234,56" in de-DE) for a price figure traders read digit-by-digit.
  return spot.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
