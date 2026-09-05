/**
 * Ex-dividend adjustment for structural-stop comparisons (deep-dive Q39).
 *
 * On ex-dividend day a stock opens lower by approximately the cash dividend amount.
 * A raw spot-vs-stop compare can false-trigger structural_stop for LONG positions when
 * the thesis did not actually break — only the corporate-action gap moved price.
 */

/** True when sessionDay is the ex-dividend date (YYYY-MM-DD). */
export function isExDividendSession(exDividendDateYmd: string, sessionDayYmd: string): boolean {
  return exDividendDateYmd.trim() === sessionDayYmd.trim();
}

export type ExDividendStructuralOpts = {
  exDividendSession?: boolean;
  exDividendCash?: number | null;
};

/**
 * Adjust underlying spot before structural-stop compare on ex-div day.
 * LONG: add cash dividend back (mechanical open gap). SHORT: no adjustment needed.
 */
export function underlyingPriceForStructuralStop(
  price: number,
  direction: "LONG" | "SHORT",
  opts: ExDividendStructuralOpts = {},
): { price: number; adjusted: boolean; detail: string } {
  const cash = opts.exDividendCash;
  if (
    !opts.exDividendSession ||
    cash == null ||
    !Number.isFinite(cash) ||
    cash <= 0
  ) {
    return { price, adjusted: false, detail: "no ex-div adjustment" };
  }
  if (direction === "LONG") {
    return {
      price: price + cash,
      adjusted: true,
      detail: `ex-div session — spot +$${cash.toFixed(2)} before structural compare`,
    };
  }
  return { price, adjusted: false, detail: "SHORT — ex-div lowers spot, no false breach" };
}

/** Resolve today's ex-div cash amount from dividend history, if any. */
export function exDividendCashForSession(
  dividends: readonly { ex_dividend_date: string; cash_amount: number }[],
  sessionDayYmd: string,
): { session: boolean; cash: number | null } {
  const hit = dividends.find(
    (d) =>
      isExDividendSession(d.ex_dividend_date, sessionDayYmd) &&
      Number.isFinite(d.cash_amount) &&
      d.cash_amount > 0,
  );
  if (!hit) return { session: false, cash: null };
  return { session: true, cash: hit.cash_amount };
}
