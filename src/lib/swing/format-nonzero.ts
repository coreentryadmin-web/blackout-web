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

/**
 * BUG FIX (Ask Largo standing mandate, 2026-10-14, live GOOGL/TSLA/AAPL/SPY repro via
 * `/api/market/gex-positioning`): every "Net GEX/VEX/DEX/CHARM" line in the swing play-brief
 * (`play-brief-intel.ts`'s gexPostureSection, `play-brief.ts`'s tradeManagerNarrativeSection,
 * `play-brief-narrative.ts`'s dealerPostureLine) divided the raw dealer-exposure dollar figure by
 * 1e6 and suffixed a bare "M", with no regard for how large the raw figure actually is. Net CHARM
 * in particular is *structurally* 10-1000x larger than net GEX at the SAME instant for the SAME
 * ticker (a property of how charm/delta-decay sensitivity is computed, not a per-ticker anomaly —
 * confirmed across GOOGL/TSLA/AAPL/SPY, every one showed the same GEX << DEX < VEX << CHARM
 * ordering), so "M" is routinely the wrong unit: a live GOOGL closed-play brief rendered
 * `Net CHARM (pinning): **-217513.8M**` and a live SPY read would render `**-3211296.7M**` — six
 * and seven significant digits in front of the decimal, which is not legible as a trade-manager
 * narrative figure and reads more like a data glitch than a dealer-exposure reading. This breaks
 * the Largo mandate's "connected trade-manager prose" bar even though every individual number is
 * correct — the UNIT is wrong, not the value.
 *
 * `formatDealerDollars` picks M/B/T by magnitude so a member reads "-217.5B", never "-217513.8M".
 * Reuses `formatFixedNonZero` at whichever scale is chosen so the existing false-zero-widening
 * behavior (a real, small net GEX must never collapse to "0.0") still applies at every scale.
 *
 * BUG FIX (Ask Largo standing mandate, 2026-11-08, round-400 class — fixed ~10 times elsewhere in
 * this repo the same day, see format-nonzero.test.ts): the unit was picked off the UNROUNDED
 * `raw` magnitude, then the quotient was rounded to 1 decimal INSIDE that chosen unit. A value
 * just under a threshold rounds UP to "1000" in the lower unit and never promotes — e.g.
 * 999,960,000 is < 1e9 so it took the M branch, then (999_960_000/1e6).toFixed(1) rounds to
 * "1000.0", rendering "1000.0M" instead of the "1.0B" it actually rounded into. Same shape at the
 * B→T boundary. Fix: after computing the rounded-to-1dp quotient at a candidate scale, check
 * whether it reached 1000 and, if so, promote to the next unit instead.
 *
 * BUG FIX (2026-11-08, same day, found while reviewing #7561 before merge — the fix above shipped
 * with a precision mismatch): the promotion guard rounded the quotient to the nearest INTEGER
 * (`Math.round(abs / 1e9)`) to decide whether to promote, but the rendered value is rounded to 1
 * DECIMAL place (`formatFixedNonZero(..., 1)`). Those two roundings disagree over the quotient
 * range [999.5, 999.95): integer rounding sends 999.6 to 1000 and promotes, while 1-decimal
 * rounding renders that same quotient as "999.6", which never reached 1000 and should NOT
 * promote. Concretely, `formatDealerDollars(999_600_000)` rendered "1.0B" when the correct output
 * (matching the formatter's own 1dp precision, and matching the already-correct sibling fix in
 * `vector-crosshair-format.ts`'s `fmtGex`, #7559) is "999.6M". Fix: round the quotient to 1
 * decimal (matching `formatFixedNonZero`'s own precision) before comparing against 1000, instead
 * of rounding to a whole integer.
 */
export function formatDealerDollars(raw: number): string {
  const abs = Math.abs(raw);
  if (abs >= 1e12) return `${formatFixedNonZero(raw / 1e12, 1)}T`;
  if (abs >= 1e9) {
    if (Math.round((abs / 1e9) * 10) / 10 >= 1000) return `${formatFixedNonZero(raw / 1e12, 1)}T`;
    return `${formatFixedNonZero(raw / 1e9, 1)}B`;
  }
  if (Math.round((abs / 1e6) * 10) / 10 >= 1000) return `${formatFixedNonZero(raw / 1e9, 1)}B`;
  return `${formatFixedNonZero(raw / 1e6, 1)}M`;
}
