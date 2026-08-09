/**
 * Aligning the GEX ladder with the price chart beside it.
 *
 * THE OBSERVED PROBLEM (live capture, NVDA, 2026-08-09). The ladder rendered strikes 162.5→300
 * (~137 points) while the chart's price axis showed ~197.5→247.5 (~50 points). Same spot, drawn
 * 135px apart vertically, on completely different scales. The panels never read as one instrument,
 * and a member hunting for their level has to scroll a rail whose range has nothing to do with what
 * the chart is showing.
 *
 * Note this is NOT a scroll-position bug. The ladder's centre-on-spot logic worked correctly in that
 * capture — spot sat ~54% down the rail. Re-centring cannot fix a RANGE mismatch, which is why the
 * fix here scopes the rows instead of nudging scrollTop.
 */

export type BandedRow = { strike: number };

/**
 * Keep only the rows a member could plausibly be looking at next to the chart.
 *
 * `band` is the chart's visible price range. Rows outside it are dropped, with `padPct` of headroom
 * on each side so the rail does not end exactly at the chart edge (a wall just off-screen is still
 * context worth seeing, and a hard cut makes the rail look truncated).
 *
 * Returns the rows UNCHANGED when there is no band — the chart may not have reported one yet, and
 * silently narrowing to a guessed band would hide walls the member expects. Degrading to today's
 * full rail is the safe direction.
 */
export function rowsInBand<T extends BandedRow>(
  rows: readonly T[],
  band: { min: number; max: number } | null | undefined,
  padPct = 0.15
): readonly T[] {
  if (!band) return rows;
  const { min, max } = band;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return rows;
  const pad = (max - min) * Math.max(0, padPct);
  const lo = min - pad;
  const hi = max + pad;
  const kept = rows.filter((r) => Number.isFinite(r.strike) && r.strike >= lo && r.strike <= hi);
  // Never return an empty rail: if the band excludes everything (a stale band from another ticker,
  // or a chart zoomed far outside the strike set), show the full ladder rather than a blank panel.
  return kept.length ? kept : rows;
}

/**
 * Scroll offset that puts `targetTop` (a row's offset within the list) at `biasPct` down the
 * viewport, rather than dead centre.
 *
 * WHY NOT CENTRED. Centring (biasPct 0.5) pushes spot to the middle of a tall rail, which sits
 * BELOW the chart's price action in the layout. Biasing to ~0.38 lifts spot into the upper third so
 * it reads level with the chart while still leaving the puts below it visible — the request was
 * "spot stays aligned with the chart at the top", not "spot centred".
 *
 * Clamped to the scrollable range so a short list cannot scroll into empty space.
 */
export function scrollOffsetForSpot(
  targetTop: number,
  targetHeight: number,
  viewportHeight: number,
  scrollHeight: number,
  biasPct = 0.38
): number {
  if (!Number.isFinite(targetTop) || !Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0;
  const bias = Math.min(0.9, Math.max(0.05, biasPct));
  const want = targetTop - viewportHeight * bias + (Number.isFinite(targetHeight) ? targetHeight / 2 : 0);
  const maxScroll = Math.max(0, (Number.isFinite(scrollHeight) ? scrollHeight : 0) - viewportHeight);
  return Math.min(maxScroll, Math.max(0, want));
}
