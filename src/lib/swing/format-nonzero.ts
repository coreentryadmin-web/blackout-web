/**
 * Fixed-decimal display formatting that never presents a real, nonzero value as "0.0" (a false
 * zero). `.toFixed(n)` rounds anything smaller than 0.5 * 10^-n straight to zero, which reads as
 * an honest absence ("no exposure", "no move") when the underlying number is real and its sign
 * still carries meaning (e.g. net GEX). Small-priced/small-cap tickers hit this routinely — a
 * $10 stock's expected-move half-width or net GEX in millions can be genuinely sub-0.05 without
 * being zero.
 */

/**
 * Format `value` to `decimals` places, widening precision only when the fixed-decimal rounding
 * would otherwise collapse a real nonzero value to zero. Capped at `decimals + 4` extra places so
 * a pathologically tiny nonzero value still renders something bounded rather than growing without
 * limit.
 */
export function formatFixedNonZero(value: number, decimals: number): string {
  const fixed = value.toFixed(decimals);
  if (value === 0 || Number(fixed) !== 0) return fixed;
  for (let extra = decimals + 1; extra <= decimals + 4; extra++) {
    const widened = value.toFixed(extra);
    if (Number(widened) !== 0) return widened;
  }
  return fixed;
}
