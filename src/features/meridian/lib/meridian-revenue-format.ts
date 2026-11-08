/**
 * Shared compact-revenue formatter for the Meridian estimates/earnings-tabs panels.
 *
 * `MeridianEarningsEstimatesPanel.tsx`'s `fmtMoney` and `MeridianEarningsTabs.tsx`'s `fmtRev`
 * independently duplicated the exact same K/M/B threshold algorithm (same thresholds, same
 * `.toFixed()` precision at each tier) — a "fix and note all of them, not just the one you
 * tripped over" blast-radius case per this repo's PR write-up policy, not two unrelated bugs.
 * Centralizing here removes the duplication AND fixes both call sites in one pass.
 *
 * BUG FIX (round 400): both duplicates picked the display unit (`M`) off the UNROUNDED value,
 * then rounded the quotient INSIDE that chosen unit:
 *
 *   if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
 *   if (abs >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
 *
 * A revenue print of $999,600,000 is `< 1e9`, so it took the `M` branch, then
 * `(999_600_000 / 1e6).toFixed(0)` rounds UP to `"1000"` — rendering the literal `"$1000M"`
 * instead of promoting to the `B` tier it had actually crossed into once rounded (`"$1.00B"`).
 * Same bug class already fixed nine times this session across this repo (`fmt-money.ts`'s
 * `fmtPremium`, `meridian-earnings-intel-core.ts`/`meridian-earnings-intel.ts`'s
 * `fmtPremShort`/`fmtPrem`, `meridian-earnings-analytics-core.ts`'s `fmtCompactMoney`,
 * `thermal-discord-card.ts`'s `fmtCompactHeatMoney`, `darkpool-discord-format.ts`'s `fmtShares`,
 * `discord-context-enrichment.ts`'s `formatAdvShareLabel`, `helix-flow-format.ts`'s `fmtOi`, and
 * `group-greek-flow-summary.ts`'s `deltaM`) — picking the display unit off the raw value before
 * rounding the quotient, so a value just under a threshold rounds up past 999/1000 in its chosen
 * unit and never promotes. Large-cap revenue prints (the realistic input here — street
 * estimates/actuals/guidance for mega-cap names) routinely land in the ordinary
 * `[$999.5M, $1B)` window, so this is a live, not theoretical, boundary.
 *
 * Real call sites fixed by centralizing here:
 *   - `MeridianEarningsEstimatesPanel.tsx` — Revenue trajectory bar's hover title
 *     (`format={fmtMoney}` on `MeridianTrajectory rows={revRows}`).
 *   - `MeridianEarningsTabs.tsx` — "Revenue est"/"Revenue actual" KV rows, the management
 *     guidance "Rev guide min – max" range, and the Street estimates list's per-row revenue
 *     figure (5 call sites of its own local `fmtRev`).
 */
export function fmtCompactRevenue(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) {
    const m = abs / 1e6;
    if (Math.round(m) >= 1000) return `$${(n / 1e9).toFixed(2)}B`;
    return `$${(n / 1e6).toFixed(0)}M`;
  }
  return `$${n.toFixed(0)}`;
}

/** Null-safe wrapper for call sites (`MeridianEarningsTabs.tsx`'s `fmtRev`) that render an
 *  optional revenue figure as an em-dash when absent. */
export function fmtCompactRevenueOrDash(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return fmtCompactRevenue(n);
}
