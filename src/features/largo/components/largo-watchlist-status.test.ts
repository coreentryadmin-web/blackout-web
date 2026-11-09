import assert from "node:assert/strict";
import { test } from "node:test";
import {
  shouldIssueWatchlistRequest,
  watchlistButtonLabel,
  type WatchlistButtonStatus,
} from "./largo-watchlist-status";

test("shouldIssueWatchlistRequest blocks a second click while the first request is in flight", () => {
  // The real bug: LargoActionsBar's onClick had no in-flight guard at all, so a member
  // double-clicking "Remember NVDA" (or clicking again before the network round-trip
  // returns) fired two concurrent updateLargoWatchlist PATCH calls for the same ticker.
  assert.equal(shouldIssueWatchlistRequest("pending"), false);
});

test("shouldIssueWatchlistRequest allows a click from every other status", () => {
  const statuses: WatchlistButtonStatus[] = ["idle", "saved", "error"];
  for (const status of statuses) {
    assert.equal(shouldIssueWatchlistRequest(status), true);
  }
});

test("watchlistButtonLabel shows in-flight, success, and error feedback distinct from the idle label", () => {
  const base = "Remember NVDA";
  assert.equal(watchlistButtonLabel(base, "idle"), base);
  assert.equal(watchlistButtonLabel(base, "pending"), "Adding…");
  assert.equal(watchlistButtonLabel(base, "saved"), "✓ Added");
  assert.equal(watchlistButtonLabel(base, "error"), "Retry — failed");
});

test("watchlistButtonLabel never silently reuses the idle label for a resolved request — that was the original bug: success and failure were visually indistinguishable from doing nothing", () => {
  const base = "Remember TSLA";
  const pendingLabel = watchlistButtonLabel(base, "pending");
  const savedLabel = watchlistButtonLabel(base, "saved");
  const errorLabel = watchlistButtonLabel(base, "error");
  assert.notEqual(savedLabel, base);
  assert.notEqual(errorLabel, base);
  assert.notEqual(savedLabel, errorLabel);
  assert.notEqual(pendingLabel, base);
});
