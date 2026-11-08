/**
 * Compact $ formatter for HELIX's contract drilldown drawer "Notional" stat
 * (`ContractDrilldownDrawer.tsx`).
 *
 * BUG (round 404, same class as 14 prior fixes this session — e.g.
 * `gex-heatmap-money-format.ts` PR #7560, `helix-tide-money-format.ts` PR #7562):
 * the unit (K/M/B) was picked off the RAW, unrounded magnitude, then the quotient was
 * rounded to that unit's own display precision AFTERWARD, with no check for whether
 * rounding itself crossed the unit boundary.
 *
 * Two real boundary cases this produced:
 *  - A notional of $999,600 is < $1,000,000 so it took the K branch, then
 *    `(999600 / 1000).toFixed(0)` rounds UP to "1000" — rendering the literal "$1000K"
 *    instead of promoting to "$1M".
 *  - A notional of $999,950,000 is < $1,000,000,000 so it took the M branch, then
 *    `(999950000 / 1_000_000).toFixed(1)` rounds UP to "1000.0" — rendering the literal
 *    "$1000.0M" instead of promoting to "$1.0B".
 *
 * FIX: after picking a unit, round the quotient to that unit's own precision FIRST, then
 * check whether the rounded value reached 1000 — if so, re-render from the next unit up
 * instead. Same round-first-then-promote guard shape as every sibling fix this session.
 *
 * Extracted from `ContractDrilldownDrawer.tsx` (a "use client" component with no render
 * harness in this repo) so the pure formatting logic can be unit-tested directly.
 */
export function fmtNotional(n: number | null): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";

  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;

  if (n >= 1_000_000) {
    const m = Number((n / 1_000_000).toFixed(1));
    if (m >= 1000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
    return `$${m.toFixed(1)}M`;
  }

  if (n >= 1_000) {
    const k = Number((n / 1_000).toFixed(0));
    if (k >= 1000) return `$${(n / 1_000_000).toFixed(1)}M`;
    return `$${k.toFixed(0)}K`;
  }

  return `$${Math.round(n)}`;
}
