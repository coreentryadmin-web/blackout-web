import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEarningsCalendarCsvLine } from "./csv-parse";

test("parses a plain, comma-only row with no quoting", () => {
  const cols = parseEarningsCalendarCsvLine("IBM,International Business Machines,2024-01-24,2023-12-31,3.78,USD");
  assert.deepEqual(cols, [
    "IBM",
    "International Business Machines",
    "2024-01-24",
    "2023-12-31",
    "3.78",
    "USD",
  ]);
});

test("keeps column count correct when the name field is RFC4180-quoted with an embedded comma", () => {
  // This is the exact row shape a real-world AlphaVantage EARNINGS_CALENDAR response uses for a
  // company whose legal name itself contains a comma. RED on the old `line.split(",")` call this
  // replaces: that call would split "Brown & Brown, Inc." into two extra columns and shift
  // reportDate (expected at index 2) one column to the right.
  const line = 'BRO,"Brown & Brown, Inc.",2024-07-24,2024-06-30,0.98,USD';
  const cols = parseEarningsCalendarCsvLine(line);
  assert.deepEqual(cols, ["BRO", "Brown & Brown, Inc.", "2024-07-24", "2024-06-30", "0.98", "USD"]);
  // Precisely the regression this exists to catch: a naive split shifts reportDate out of index 2
  // and corrupts it into the tail of the name, so the caller's date-shape check silently drops the
  // row — this ticker's real report date would read as "no upcoming earnings" instead of the truth.
  const naiveSplit = line.split(",");
  assert.notEqual(naiveSplit[2]?.trim(), "2024-07-24", "sanity: the naive split this replaces really does corrupt the date column");
  assert.equal(cols[2], "2024-07-24");
});

test("unescapes a doubled quote inside a quoted field", () => {
  const line = 'ABC,"Smith "" Co",2024-03-01,2023-12-31,1.00,USD';
  const cols = parseEarningsCalendarCsvLine(line);
  assert.deepEqual(cols, ["ABC", 'Smith " Co', "2024-03-01", "2023-12-31", "1.00", "USD"]);
});

test("handles multiple quoted commas in the same row", () => {
  const line = 'XYZ,"Doe, Smith & Partners, LLC",2024-05-10,2024-03-31,0.5,USD';
  const cols = parseEarningsCalendarCsvLine(line);
  assert.deepEqual(cols, ["XYZ", "Doe, Smith & Partners, LLC", "2024-05-10", "2024-03-31", "0.5", "USD"]);
});

test("handles an empty trailing field", () => {
  const cols = parseEarningsCalendarCsvLine("AAA,Acme,2024-02-02,2023-12-31,,USD");
  assert.deepEqual(cols, ["AAA", "Acme", "2024-02-02", "2023-12-31", "", "USD"]);
});
