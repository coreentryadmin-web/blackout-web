import test from "node:test";
import assert from "node:assert/strict";
import { isQuarterlyOpex, opexDatesInRange, thirdFriday } from "./vector-opex";

test("third Friday is computed, not approximated", () => {
  // Hand-checked against a calendar. The August 2026 case is the one that matters: 2026-08-01
  // is a Saturday, so the first Friday is the 7th and OPEX is the 21st — a naive
  // "Friday nearest the 15th" rule returns the 14th and misplaces the marker by a week.
  assert.equal(thirdFriday(2026, 8), "2026-08-21");
  assert.equal(thirdFriday(2026, 1), "2026-01-16");
  assert.equal(thirdFriday(2026, 5), "2026-05-15");
  assert.equal(thirdFriday(2025, 12), "2025-12-19");
  assert.equal(thirdFriday(2024, 2), "2024-02-16");
});

test("every computed date really is a Friday", () => {
  // Cheap invariant that would catch an off-by-one in the day-of-week arithmetic across every
  // month/year combination, which spot-checked dates alone cannot.
  for (let y = 2023; y <= 2027; y++) {
    for (let m = 1; m <= 12; m++) {
      const d = thirdFriday(y, m);
      assert.equal(new Date(`${d}T00:00:00Z`).getUTCDay(), 5, `${d} is not a Friday`);
      const day = Number(d.slice(8));
      assert.ok(day >= 15 && day <= 21, `${d} outside the third-Friday window`);
    }
  }
});

test("range query returns only dates inside the bar window", () => {
  const from = Date.parse("2026-01-01T00:00:00Z");
  const to = Date.parse("2026-12-31T00:00:00Z");
  const dates = opexDatesInRange(from, to);
  assert.equal(dates.length, 12, "one monthly OPEX per month");
  assert.equal(dates[0], "2026-01-16");
  assert.equal(dates.at(-1), "2026-12-18");
  // Ascending, no duplicates.
  assert.deepEqual([...dates].sort(), dates);
  assert.equal(new Set(dates).size, dates.length);
});

test("a narrow range yields few or no markers", () => {
  // A 30-session 4H history must not be carpeted with markers.
  const from = Date.parse("2026-08-01T00:00:00Z");
  const to = Date.parse("2026-08-31T00:00:00Z");
  assert.deepEqual(opexDatesInRange(from, to), ["2026-08-21"]);
  // A window that contains no third Friday returns nothing rather than clamping to a nearby one.
  assert.deepEqual(opexDatesInRange(Date.parse("2026-08-01T00:00:00Z"), Date.parse("2026-08-10T00:00:00Z")), []);
});

test("degenerate ranges are rejected, not guessed at", () => {
  assert.deepEqual(opexDatesInRange(NaN, 1), []);
  assert.deepEqual(opexDatesInRange(1, NaN), []);
  assert.deepEqual(opexDatesInRange(Date.parse("2026-06-01T00:00:00Z"), Date.parse("2026-01-01T00:00:00Z")), [], "to < from");
});

test("quarterly OPEX is distinguished from monthly", () => {
  // Triple witching — index futures, index options and stock options expire together, so the
  // unwind is materially larger and the marker should read differently.
  for (const d of ["2026-03-20", "2026-06-19", "2026-09-18", "2026-12-18"]) {
    assert.equal(isQuarterlyOpex(d), true, d);
  }
  for (const d of ["2026-01-16", "2026-08-21", "2026-11-20"]) {
    assert.equal(isQuarterlyOpex(d), false, d);
  }
});
