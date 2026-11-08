/**
 * Compact dollar-value formatters shared by the GEX Heatmap (Thermal) panel.
 *
 * Extracted from `GexHeatmap.tsx` (a client component with no render harness) so the
 * round-first-then-promote boundary logic below can carry a direct unit test — see the
 * sibling `.test.ts` file.
 */

/** Rounds `value / unitSize` to 1 decimal place — the exact precision each unit displays at. */
function roundToUnitTenth(value: number, unitSize: number): number {
  return Math.round((value / unitSize) * 10) / 10;
}

/**
 * Compact signed dollar value: $22.1K / -$45.2M / $1.2B.
 *
 * ROUND-FIRST-THEN-PROMOTE: the unit (K/M/B) must be re-checked AFTER rounding the quotient to
 * that unit's own display precision (1dp), not left to whatever the raw-magnitude threshold
 * check picked. The previous implementation picked the unit off the raw value and rounded the
 * quotient afterward, so a value just under a threshold would round UP past 999.95 in its chosen
 * unit and never promote — e.g. 999_950_000 is `< 1_000_000_000` so it picked "M", then
 * `(999_950_000 / 1_000_000).toFixed(1)` rounds to "1000.0", printing "$1000.0M" instead of the
 * correct "$1.0B". The same shape bites the K/M boundary too (999_950 -> old "$1000.0K" instead
 * of the correct "$1.0M"). Rounding to the unit's own precision FIRST, then checking whether
 * THAT rounded value crossed into the next unit, fixes both boundaries.
 */
export function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs < 1) return "·";

  if (abs >= 1_000_000_000) {
    return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  }

  if (abs >= 1_000_000) {
    const millions = roundToUnitTenth(abs, 1_000_000);
    if (millions >= 1000) return `${sign}$${(millions / 1000).toFixed(1)}B`;
    return `${sign}$${millions.toFixed(1)}M`;
  }

  if (abs >= 1_000) {
    const thousands = roundToUnitTenth(abs, 1_000);
    if (thousands >= 1000) return `${sign}$${(thousands / 1000).toFixed(1)}M`;
    return `${sign}$${thousands.toFixed(1)}K`;
  }

  return `${sign}$${abs.toFixed(0)}`;
}

/** Always-signed compact dollar value: +$22.1K / -$45.2M. Used where sign is meaning. */
export function fmtMoneySigned(n: number): string {
  if (n === 0) return "·";
  return n > 0 ? `+${fmtMoney(n)}` : fmtMoney(n);
}
