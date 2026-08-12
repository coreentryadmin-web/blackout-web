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
/**
 * Fewest rows the rail should ever show when the ladder HAS more available.
 *
 * A band-scoped rail can be far too short as well as too long. Live capture, SPY 2026-08-12: the
 * chart was zoomed to roughly 770-776 and SPY's strikes are $1 apart, so the band matched SEVEN
 * rows — in a panel with room for around forty. The API had served 163. The member saw a nearly
 * empty column and no idea where the real walls sat, which is the same "where is my structure"
 * failure the band was introduced to fix, just from the other direction.
 *
 * The old guard only caught the degenerate case (band matches NOTHING). Between "nothing" and
 * "everything" there is a wide range of bands that technically match but leave the panel useless.
 */
const MIN_BAND_ROWS = 24;

export function rowsInBand<T extends BandedRow>(
  rows: readonly T[],
  band: { min: number; max: number } | null | undefined,
  padPct = 0.15,
  opts: { minRows?: number; anchor?: number | null } = {}
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
  if (kept.length === 0) return rows;

  // Too FEW rows is its own failure. Widen back out around the anchor (spot, or the band's centre
  // when spot is unknown) until the panel has something to show. Taking the nearest-N rather than
  // scaling the band up by a factor keeps the result predictable on any strike spacing: SPY at $1
  // and SPX at $5 both end up with the same row COUNT, which is what the panel's height cares
  // about.
  const minRows = Math.max(0, Math.floor(opts.minRows ?? MIN_BAND_ROWS));
  // The floor applies ONLY when the ladder actually holds enough rows to fill the panel. On a thin
  // chain the band must still win: the original reason this scoping exists is the NVDA case, where
  // a 9-row rail spanning 162.5-300 had to be cut to the chart's 197.5-247.5 — five rows, and
  // correctly so. Widening that back out would undo the fix rather than complement it. The panel
  // is only "too empty" when rows are being HIDDEN, which needs the full set to be big enough to
  // hide something worth seeing.
  if (rows.length < minRows) return kept;
  if (kept.length >= minRows) return kept;

  const anchor =
    opts.anchor != null && Number.isFinite(opts.anchor) ? opts.anchor : (min + max) / 2;
  const nearest = rows
    .filter((r) => Number.isFinite(r.strike))
    .slice()
    .sort((a, b) => Math.abs(a.strike - anchor) - Math.abs(b.strike - anchor))
    .slice(0, minRows);
  const chosen = new Set(nearest.map((r) => r.strike));
  // Re-emit in the INPUT's order rather than the distance order used to pick: the rail renders
  // strike-descending and the spot marker is placed by scanning for the first row at/below spot,
  // so handing back distance-sorted rows would scramble the panel.
  return rows.filter((r) => chosen.has(r.strike));
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
