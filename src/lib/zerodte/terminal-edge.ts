/**
 * TERMINAL "EDGE" LAYER helpers (Night Hawk Wave 3) — small, pure, dependency-free display
 * transforms for the PlayTerminal's edge widgets. Kept out of the React module so they are
 * trivially unit-tested (no DOM, no SWR, no clock).
 *
 * Two widgets live here:
 *  1. excursionBar — the MAE/MFE heat-range bar (the best/worst premium excursion since entry,
 *     with the current mark placed between them). It is deliberately a RANGE, not a per-tick
 *     path: the board payload carries only the latched extremes (peak_premium/trough_premium),
 *     NOT a per-tick mark history, so drawing a sparkline would fabricate a path we never saw.
 *  2. formatWinRateCi — the honest win-rate string: a point estimate is NEVER shown bare; it is
 *     always paired with the Wilson 95% CI when the payload carries one, or an explicit "CI n/a"
 *     when it does not (we never fabricate an interval — the CI is computed upstream, WS-07/WS-09).
 */

/** Clamp to [0,1]. */
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The resolved excursion-range bar. All three levels (best/worst/current) are in the SAME,
 *  already-structure-aware percent space the adapter produced — i.e. for a CREDIT condor the
 *  adapter has ALREADY seller-framed peak/trough/pnl (best = deepest decay), so this helper
 *  never re-inverts anything. It only lays the three numbers out on a shared axis. */
export interface ExcursionBar {
  /** MFE — the best (highest) excursion % since entry. */
  best: number;
  /** MAE — the worst (lowest) excursion % since entry. */
  worst: number;
  /** The live P&L % now (null when not entered / no mark). */
  current: number | null;
  /** best − worst, the heat range in points of % (always ≥ 0). */
  range: number;
  /** 0..1 position of `current` within [worst, best]; null when current is absent. A
   *  zero-width range (best === worst) centers the marker at 0.5 (no spread to place it on). */
  currentFrac: number | null;
  /** True when the whole run was in profit at its best (best > 0) — drives the green cap. */
  bestIsUp: boolean;
  /** True when the worst point was a loss (worst < 0) — drives the red floor. */
  worstIsDown: boolean;
}

/**
 * Build the excursion (MAE/MFE) bar from the best/worst/current excursion percentages.
 *
 * Inputs are the adapter's structure-aware peak (MFE), trough (MAE) and live pnl (current) —
 * see terminalPlayFromZeroDte, which seller-frames a condor at the source. Returns null when
 * either extreme is absent (nothing to draw — the terminal shows the plain peak/trough chips
 * instead, never a fabricated bar). Defensive: if the extremes arrive inverted (best < worst)
 * they are ordered so the axis is always well-formed.
 */
export function excursionBar(
  best: number | null | undefined,
  worst: number | null | undefined,
  current: number | null | undefined,
): ExcursionBar | null {
  if (best == null || !Number.isFinite(best) || worst == null || !Number.isFinite(worst)) return null;
  // Order defensively — the adapter's invariant is peak ≥ trough, but never trust it blindly.
  const hi = Math.max(best, worst);
  const lo = Math.min(best, worst);
  const range = hi - lo;
  const cur = current != null && Number.isFinite(current) ? current : null;
  const currentFrac = cur == null ? null : range <= 0 ? 0.5 : clamp01((cur - lo) / range);
  return { best: hi, worst: lo, current: cur, range, currentFrac, bestIsUp: hi > 0, worstIsDown: lo < 0 };
}

/** Sign → phosphor color class for an excursion cap/label: a positive % is green ("up"), a
 *  negative % is red ("dn"), exactly zero is neutral ("flat"). Drives the MAE/MFE cap colors BY
 *  THEIR ACTUAL SIGN so an all-green run never paints its MAE cap red (honest number AND color). */
export function signColorClass(v: number): "up" | "dn" | "flat" {
  return v > 0 ? "up" : v < 0 ? "dn" : "flat";
}

/** The scorecard fields the win-rate formatter reads. ciLow/ciHigh are Wilson 95% bounds in
 *  PERCENT units (matching calibration's win_rate_ci_pct), null/absent when not computed. */
export interface WinRateCiInput {
  winRate: number;
  n: number;
  ciLow?: number | null;
  ciHigh?: number | null;
}

/**
 * Format a strategy win-rate HONESTLY — never a bare point estimate.
 *  - CI present  → "63% WR (95% CI 55–70%, n=214)"
 *  - CI absent   → "63% WR (n=214 · CI n/a)"   (explicit, never a fabricated interval)
 * The interval is computed upstream (Wilson score interval, WS-07/WS-09); this only renders it.
 */
export function formatWinRateCi(s: WinRateCiInput): string {
  const n = Number.isFinite(s.n) ? s.n : 0;
  // A non-finite win-rate (e.g. n=0 → 0/0) must never render "NaN% WR" — fall to the CI-n/a path
  // with a "—" placeholder for the estimate itself (honest: no rate, no interval).
  if (!Number.isFinite(s.winRate)) return `— WR (n=${n} · CI n/a)`;
  const wr = `${Math.round(s.winRate)}% WR`;
  const lo = s.ciLow;
  const hi = s.ciHigh;
  const hasCi = lo != null && Number.isFinite(lo) && hi != null && Number.isFinite(hi);
  if (hasCi) {
    // Order the bounds defensively so a swapped lo/hi still reads low→high.
    const l = Math.round(Math.min(lo!, hi!));
    const h = Math.round(Math.max(lo!, hi!));
    return `${wr} (95% CI ${l}–${h}%, n=${n})`;
  }
  return `${wr} (n=${n} · CI n/a)`;
}
