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
  assert.equal(countActiveHelixFilters({ ...BASE, watchlistOnly: true }), 1);
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
