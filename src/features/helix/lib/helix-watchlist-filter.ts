/**
 * Is the "watchlist only" filter actually DOING anything?
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────────────────────────
 *
 * `applyTapeFilters` guards the watchlist filter on a non-empty list:
 *
 *     if (watchlistOnly && watchlist.watchlistSet.size > 0) { ...filter... }
 *
 * which is right — filtering to an empty set would blank the tape. But the CHROME did not know:
 * `activeFilterCount` counted `watchlistOnly ? 1 : 0` unconditionally, and the chip rendered its
 * active (gold) style off the same flag. So with the flag on and the list empty, a member saw a
 * lit chip, counted as an active filter, **filtering nothing** — and the chip is `disabled` when
 * the list is empty, so they could not turn it off either.
 *
 * ── THE PART THAT SAYS THIS WAS KNOWN ───────────────────────────────────────────────────────────
 *
 * `WatchlistBar`'s `onClear` already read `() => { watchlist.clear(); setWatchlistOnly(false); }`.
 * The invariant was understood and hand-applied at exactly ONE of the three ways a watchlist can
 * empty. `onRemove` (the per-row ✕) and `onToggleStar` (un-starring the last ticker, from the tape
 * or the drawer) did not carry it, and both leave the flag stuck on.
 *
 * A hand-applied invariant at one of three call sites is not an invariant. So it lives here, and
 * the filter, the counter and the reset all ask the same question instead of three flags agreeing
 * by maintenance.
 */

/**
 * True only when the filter will actually narrow the tape. Both the predicate in
 * `applyTapeFilters` and the chip counter read this, so they cannot disagree about whether the
 * watchlist filter is doing anything.
 */
export function watchlistFilterActive(watchlistOnly: boolean, watchlistSize: number): boolean {
  return watchlistOnly && watchlistSize > 0;
}

/**
 * True when the flag is on but has nothing to filter — the stuck state. The component clears the
 * flag on this rather than leaving a lit, uncounted-for, un-clickable chip behind.
 *
 * Kept separate from `watchlistFilterActive` on purpose: "this filter is inert" and "this filter
 * should be switched off" are the same condition today, and would stop being if the product ever
 * decided an empty watchlist should blank the tape instead. Naming both makes that a decision
 * rather than an edit to a shared boolean.
 */
export function watchlistFilterStuck(watchlistOnly: boolean, watchlistSize: number): boolean {
  return watchlistOnly && watchlistSize === 0;
}
