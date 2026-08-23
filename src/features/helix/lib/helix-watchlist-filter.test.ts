import { test } from "node:test";
import assert from "node:assert/strict";
import { watchlistFilterActive, watchlistFilterStuck } from "./helix-watchlist-filter";
import { countActiveHelixFilters } from "@/features/helix/components/HelixCommandBar";

const base = {
  minPremium: 200_000,
  typeFilter: "ALL" as const,
  whalesOnly: false,
  dteFilter: "all" as const,
  indicesOnly: false,
  watchlistOnly: false,
  watchlistCount: 0,
  tickerFilter: "",
};

test("the filter is active only when the flag is on AND there is something to filter", () => {
  assert.equal(watchlistFilterActive(true, 3), true);
  assert.equal(watchlistFilterActive(true, 0), false);
  assert.equal(watchlistFilterActive(false, 3), false);
  assert.equal(watchlistFilterActive(false, 0), false);
});

test("the stuck state is exactly: flag on, list empty", () => {
  assert.equal(watchlistFilterStuck(true, 0), true);
  assert.equal(watchlistFilterStuck(true, 1), false);
  assert.equal(watchlistFilterStuck(false, 0), false);
});

test("active and stuck are mutually exclusive and cover the flag-on cases", () => {
  // If both could be true, the component would clear a filter that was doing work. If neither
  // could be true with the flag on, a state would exist that nothing describes.
  for (const size of [0, 1, 5]) {
    const a = watchlistFilterActive(true, size);
    const st = watchlistFilterStuck(true, size);
    assert.equal(a && st, false, `both true at size ${size}`);
    assert.equal(a || st, true, `neither true at size ${size}`);
  }
});

test("an inert watchlist filter is NOT counted as an active filter — the defect", () => {
  // The flag is on and the chip is lit, but the list is empty so `applyTapeFilters` skips it.
  // Counting it told the member they had filtered something when the tape was unfiltered.
  const stuck = { ...base, watchlistOnly: true, watchlistCount: 0 };
  assert.equal(countActiveHelixFilters(stuck), 0);
});

test("a watchlist filter with entries IS counted", () => {
  const real = { ...base, watchlistOnly: true, watchlistCount: 4 };
  assert.equal(countActiveHelixFilters(real), 1);
});

test("the count is unaffected by watchlistCount when the flag is off", () => {
  // Starring tickers without enabling the filter must not read as a filter.
  assert.equal(countActiveHelixFilters({ ...base, watchlistCount: 9 }), 0);
});

test("the other filters still count independently", () => {
  assert.equal(countActiveHelixFilters({ ...base, whalesOnly: true }), 1);
  assert.equal(countActiveHelixFilters({ ...base, typeFilter: "CALL" }), 1);
  assert.equal(countActiveHelixFilters({ ...base, tickerFilter: "NVDA" }), 1);
  assert.equal(
    countActiveHelixFilters({
      ...base,
      whalesOnly: true,
      indicesOnly: true,
      watchlistOnly: true,
      watchlistCount: 2,
    }),
    3
  );
});
