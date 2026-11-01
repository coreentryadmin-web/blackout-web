// BUG (found live, round 320 discovery-lane audit): fetchShortInterest's three numeric fields
// (short_interest, avg_daily_volume, days_to_cover) were built with `Number(row.<field> ?? 0)`.
// `?? 0` silently turns a field Polygon OMITS from the response (its documented convention for
// "not computable/not reported for this ticker" -- days_to_cover in particular is undefined, and
// so omitted, whenever avg_daily_volume is 0 or unreported) into the NUMBER ZERO -- indistinguishable
// from a genuine "0 days to cover" / "0 shares short" reading. Those mean opposite things: a real 0
// days-to-cover says "fully liquid, no squeeze risk"; an absent reading says "we don't know, never
// measured." This is the same class of bug this file's sibling `ratioNum` helper exists to prevent
// for the financial-ratios endpoint (see polygon-ratio-num-null.test.ts) -- `fetchShortInterest` was
// shaping its row with a bare `Number(x ?? 0)` instead of the null-safe coercion every other "parse
// an unknown API field to number-or-null" helper in this file already uses.
//
// Fix: `shapeShortInterestRow`/`shortInterestNum` mirror the null-safe pattern -- a missing/null
// field stays `null`, a genuine `0` is preserved as `0`.
import assert from "node:assert/strict";
import test from "node:test";
import { shapeShortInterestRow, shortInterestNum } from "./polygon";

test("shortInterestNum: a missing field (undefined) stays null, never becomes 0", () => {
  assert.equal(shortInterestNum(undefined), null);
});

test("shortInterestNum: an explicit JSON null stays null", () => {
  assert.equal(shortInterestNum(null), null);
});

test("shortInterestNum: a genuine zero reading is preserved, not confused with absence", () => {
  assert.equal(shortInterestNum(0), 0);
  assert.equal(shortInterestNum("0"), 0);
});

test("shortInterestNum: a real finite number/string passes through unchanged", () => {
  assert.equal(shortInterestNum(1_250_000), 1_250_000);
  assert.equal(shortInterestNum("3.7"), 3.7);
});

test("shapeShortInterestRow: days_to_cover omitted by Polygon (avg_daily_volume unreported) stays null, not 0", () => {
  // Real Polygon shape for a thinly-reported ticker: short_interest present, but
  // avg_daily_volume/days_to_cover genuinely absent from the row (no key at all).
  const row = { settlement_date: "2026-10-15", short_interest: 42_000 };
  const shaped = shapeShortInterestRow(row, "THIN");
  assert.equal(shaped.short_interest, 42_000);
  assert.equal(shaped.avg_daily_volume, null, "absent avg_daily_volume must stay null, not become 0");
  assert.equal(shaped.days_to_cover, null, "absent days_to_cover must stay null -- 0 would read as 'no squeeze risk' instead of 'unknown'");
});

test("shapeShortInterestRow: a genuine zero days_to_cover is preserved (not re-nulled)", () => {
  const row = { settlement_date: "2026-10-15", short_interest: 100, avg_daily_volume: 5_000_000, days_to_cover: 0 };
  const shaped = shapeShortInterestRow(row, "LIQUID");
  assert.equal(shaped.days_to_cover, 0);
});

test("shapeShortInterestRow: all three numerics present and finite round-trip unchanged", () => {
  const row = { settlement_date: "2026-10-15", short_interest: 1_500_000, avg_daily_volume: 800_000, days_to_cover: 1.875 };
  const shaped = shapeShortInterestRow(row, "AAPL");
  assert.deepEqual(shaped, {
    ticker: "AAPL",
    settlement_date: "2026-10-15",
    short_interest: 1_500_000,
    avg_daily_volume: 800_000,
    days_to_cover: 1.875,
    source: "massive_stocks_v1",
  });
});
