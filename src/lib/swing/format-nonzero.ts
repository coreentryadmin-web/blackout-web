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
 */
export function formatDealerDollars(raw: number): string {
  const abs = Math.abs(raw);
  if (abs >= 1e12) return `${formatFixedNonZero(raw / 1e12, 1)}T`;
  if (abs >= 1e9) return `${formatFixedNonZero(raw / 1e9, 1)}B`;
  return `${formatFixedNonZero(raw / 1e6, 1)}M`;
}
