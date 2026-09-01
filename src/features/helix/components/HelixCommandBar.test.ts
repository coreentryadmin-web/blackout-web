import test from "node:test";
import assert from "node:assert/strict";
import { countActiveHelixFilters } from "./HelixCommandBar";

const BASE = {
  minPremium: 200_000,
  typeFilter: "ALL" as const,
  whalesOnly: false,
  dteFilter: "all" as const,
  indicesOnly: false,
  watchlistOnly: false,
  watchlistCount: 0,
  tickerFilter: "",
};

// Root cause (2026-08-02 Helix audit, Tier 1 item #7): the desktop filter bar rendered
// as-is on mobile web with no responsive fallback, forcing a cramped/scrolling layout.
// The fix collapses it into a mobile bottom sheet behind a "Filters · N" trigger — this
// pins the active-count math that drives that label.
test("countActiveHelixFilters: all-default filters count as zero", () => {
  assert.equal(countActiveHelixFilters(BASE), 0);
});

test("countActiveHelixFilters: counts each non-default filter independently", () => {
  assert.equal(countActiveHelixFilters({ ...BASE, minPremium: 1_000_000 }), 1);
  assert.equal(countActiveHelixFilters({ ...BASE, typeFilter: "CALL" }), 1);
  assert.equal(countActiveHelixFilters({ ...BASE, whalesOnly: true }), 1);
  assert.equal(countActiveHelixFilters({ ...BASE, dteFilter: "0dte" }), 1);
  assert.equal(countActiveHelixFilters({ ...BASE, indicesOnly: true }), 1);
  // CHANGED 2026-08-23, deliberately: this line used to read `{ ...BASE, watchlistOnly: true }`
  // and expect 1 — i.e. it asserted the defect. `applyTapeFilters` skips the watchlist filter on
  // an empty list, so the flag alone narrows nothing, and counting it told the member they had
  // filtered something when the tape was unfiltered. The count now needs the list too.
  assert.equal(countActiveHelixFilters({ ...BASE, watchlistOnly: true, watchlistCount: 3 }), 1);
  assert.equal(countActiveHelixFilters({ ...BASE, tickerFilter: "SPX" }), 1);
});

test("countActiveHelixFilters: sums multiple simultaneous non-default filters", () => {
  assert.equal(
    countActiveHelixFilters({
      ...BASE,
      minPremium: 1_000_000,
      whalesOnly: true,
      tickerFilter: "SPX",
    }),
    3
  );
});

test("countActiveHelixFilters: counts direction and opening filters", () => {
  assert.equal(countActiveHelixFilters({ ...BASE, directionFilter: "bullish" }), 1);
  assert.equal(countActiveHelixFilters({ ...BASE, openingOnly: true }), 1);
});

test("countActiveHelixFilters: an INERT watchlist filter counts as zero", () => {
  // The flag is on and the chip renders lit, but the list is empty so nothing is filtered. This
  // is the state the old assertion above blessed.
  assert.equal(countActiveHelixFilters({ ...BASE, watchlistOnly: true, watchlistCount: 0 }), 0);
});

test("countActiveHelixFilters: starred tickers alone are not a filter", () => {
  // A member can star names without switching the filter on; that must not read as filtering.
  assert.equal(countActiveHelixFilters({ ...BASE, watchlistCount: 9 }), 0);
});
