/**
 * Pure GEX-magnitude formatter for the chart crosshair legend (`VectorCrosshairLegend.tsx`'s
 * `renderVectorCrosshairLegend`, the "GEX <strike> <value>" line painted on hover over the GEX
 * heatmap overlay). Extracted to a sibling `.ts` module because the component is imperatively
 * painted into a `ref` with no render harness (same extraction pattern as
 * `vector-age-format.ts`/`vector-compare-format.ts`) — a plain `node --test` can exercise the
 * pure math directly without mounting React.
 *
 * BUG FIX (round 401): the original inline `fmtGex` picked the display unit (K/M/B) off the RAW,
 * unrounded magnitude, then rounded the quotient to that unit's own display precision
 * afterward — so a value just under a unit threshold rounds UP past 999/1000 once formatted, and
 * never promotes to the next unit:
 *
 *   if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
 *   if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;   // <- picks M before rounding
 *   if (abs >= 1e3) return `${(n / 1e3).toFixed(0)}K`;   // <- picks K before rounding
 *
 * `999_600_000` is `< 1e9`, so it took the `M` branch, then `(999_600_000 / 1e6).toFixed(1)`
 * rounds UP to `"1000.0"`, rendering the literal `"1000.0M"` instead of promoting to the `B` tier
 * it had actually crossed into once rounded (`"1.0B"`). Same shape at the K->M boundary:
 * `999_600` is `< 1e6`, took the `K` branch, `(999_600 / 1e3).toFixed(0)` rounds UP to `"1000"`,
 * rendering `"1000K"` instead of `"1.0M"`.
 *
 * Same bug class already fixed repeatedly this session across the repo (`fmt-money.ts`'s
 * `fmtPremium`, `helix-flow-format.ts`'s `fmtOi`, `meridian-revenue-format.ts`'s
 * `fmtCompactRevenue`, `thermal-discord-card.ts`'s `fmtCompactHeatMoney`,
 * `darkpool-discord-format.ts`'s `fmtShares`, among others) — picking the display unit off the
 * raw value before rounding the quotient inside it is the recurring defect shape; this GEX
 * formatter was explicitly flagged and deliberately left for a future round when the Meridian
 * revenue-formatter fix landed (same bug class, different feature area).
 *
 * Fix: round-first-then-promote at each boundary — compute the candidate unit's rounded
 * magnitude (matching that unit's own `.toFixed()` precision) BEFORE deciding whether it crossed
 * into the next unit, promoting to the next tier when it did. Precision at each tier (B: 1dp,
 * M: 1dp, K: 0dp) is unchanged from the original so no display format shifts for values that
 * were never near a boundary.
 */
export function fmtGex(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) {
    // Round-first-then-promote guard: a magnitude that rounds to 1000.0 (this unit's own 1dp
    // precision) belongs in the next unit up, not an overflowed four-digit label.
    if (Math.round((abs / 1e6) * 10) / 10 >= 1000) return `${(n / 1e9).toFixed(1)}B`;
    return `${(n / 1e6).toFixed(1)}M`;
  }
  if (abs >= 1e3) {
    // Same guard at the K->M boundary, matching K's own 0dp precision.
    if (Math.round(abs / 1e3) >= 1000) return `${(n / 1e6).toFixed(1)}M`;
    return `${(n / 1e3).toFixed(0)}K`;
  }
  return Math.round(n).toLocaleString("en-US");
}
