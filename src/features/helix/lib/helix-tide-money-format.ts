/**
 * Compact $ formatter for the HELIX tide bar's "calls bought" / "puts sold" labels
 * (`HelixTideBar.tsx`).
 *
 * BUG (round 403, same class as 13 prior fixes this session — see e.g.
 * `gex-heatmap-money-format.ts`, `meridian-earnings-intel-core.ts`'s `fmtPremShort`):
 * the unit (K/M/B) was picked off the RAW, unrounded magnitude, then the quotient was
 * rounded to that unit's own display precision AFTERWARD. A net premium of $999,600 is
 * < $1,000,000 so it took the K branch, then `(999600 / 1000).toFixed(0)` rounds UP to
 * "1000" — rendering the literal "$1000K" instead of promoting to "$1.0M". The identical
 * shape exists one tier up: $999,600,000 takes the M branch (< $1,000,000,000) and
 * `(999600000 / 1_000_000).toFixed(0)` rounds to "1000", rendering "$1000M" instead of
 * "$1.0B".
 *
 * FIX: after picking a unit, round the quotient to that unit's own precision FIRST, then
 * check whether the rounded value reached 1000 — if so, re-render from the next unit up
 * instead. Same round-first-then-promote guard shape as every sibling fix this session.
 *
 * Extracted from `HelixTideBar.tsx` (a "use client" component with no render harness) so
 * the pure formatting logic can be unit-tested directly.
 */
export function fmtMoney(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    if (Math.round(m) >= 1000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
    return `$${m.toFixed(0)}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    if (Math.round(k) >= 1000) return `$${(n / 1_000_000).toFixed(0)}M`;
    return `$${k.toFixed(0)}K`;
  }
  return `$${n.toFixed(0)}`;
}
