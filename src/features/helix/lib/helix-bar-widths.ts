/**
 * Bar geometry for the Net Premium leaderboard.
 *
 * EXTRACTED FROM THE COMPONENT (2026-08-23) so it can be tested at all — the arithmetic below was
 * three inline expressions inside a `.map()` in `NetPremiumLeaderboard.tsx`, unreachable from a
 * test, and one of them divided by a value the same file guards two lines earlier.
 *
 * THE DEFECT. The row builder already refuses to divide by zero when it computes `callPct`:
 *
 *     callPct: calls + puts > 0 ? Math.round((calls / (calls + puts)) * 100) : 50
 *
 * …and then the render path recomputed THE SAME RATIO without the guard:
 *
 *     const callBarW = Math.round((row.calls / row.total) * barW);
 *
 * For a ticker whose prints all carry zero premium, `row.total` is 0 and both bars render
 * `width: NaN%` — executed and confirmed, while `callPct` on the same row correctly returns 50.
 * The guard existed, in the same file, on the same quantity; it just was not applied where the
 * division actually happens. That is the same shape as several defects this lane has fixed lately:
 * a guard placed where the bug was found rather than everywhere the bug can occur.
 *
 * REACHABLE, if narrowly: a row exists for any ticker present on the tape, `.slice()` only trims
 * the top N, so on a thin or filtered tape a zero-premium ticker reaches the render.
 *
 * The zero case returns 0-width bars rather than a 50/50 split, which is what `barW` itself already
 * evaluates to — a row with no premium should draw nothing, not half a bar of each colour.
 */

export type LeaderBarRow = {
  calls: number;
  puts: number;
  total: number;
};

export type LeaderBarWidths = {
  /** The row's share of the largest row, 0–100. */
  barW: number;
  /** Call slice of `barW`. */
  callBarW: number;
  /** Put slice — always `barW - callBarW`, so the two can never overflow the rail. */
  putBarW: number;
};

export function leaderBarWidths(row: LeaderBarRow, maxTotal: number): LeaderBarWidths {
  // `maxTotal` is the largest row's total. A non-positive one means there is nothing to scale
  // against, so every bar is empty rather than infinite.
  const barW = maxTotal > 0 ? Math.round((row.total / maxTotal) * 100) : 0;
  const callBarW = row.total > 0 ? Math.round((row.calls / row.total) * barW) : 0;
  // Derived by subtraction, never by a second division: the two slices must sum to exactly `barW`
  // or the rail over- or under-fills by a rounding step.
  return { barW, callBarW, putBarW: barW - callBarW };
}
