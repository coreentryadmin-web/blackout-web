/**
 * Pure state machine for the "Remember <TICKER>" watchlist button in LargoActionsBar.
 *
 * Extracted so the guard-against-double-submit and label logic can be unit tested without
 * mounting a React tree (this repo's test runner is plain node:test + tsx, not jsdom/RTL).
 */

export type WatchlistButtonStatus = "idle" | "pending" | "saved" | "error";

/**
 * Whether a click on the watchlist button should actually fire the PATCH request.
 *
 * The bug this guards: the button previously had no disabled/in-flight state at all, so a
 * double-click (or an impatient member re-clicking before the first request resolves) fired a
 * second concurrent `updateLargoWatchlist` call for the same ticker with no benefit and a real
 * risk of a duplicate/garbled write landing after the first. Once a request is in flight or has
 * already succeeded, a further click is a no-op until it resolves (and a fresh click after
 * `"saved"` is harmless — re-adding an already-remembered ticker — so only `"pending"` blocks).
 */
export function shouldIssueWatchlistRequest(status: WatchlistButtonStatus): boolean {
  return status !== "pending";
}

/** Button label for the current status, falling back to the action's own label when idle/saved-reset. */
export function watchlistButtonLabel(baseLabel: string, status: WatchlistButtonStatus): string {
  switch (status) {
    case "pending":
      return "Adding…";
    case "saved":
      return "✓ Added";
    case "error":
      return "Retry — failed";
    case "idle":
    default:
      return baseLabel;
  }
}
