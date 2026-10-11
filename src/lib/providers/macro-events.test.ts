import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUwEconomicCalendar } from "./macro-events";

test("parseUwEconomicCalendar labels FOMC minutes separately from decisions", () => {
  const events = parseUwEconomicCalendar([
    { type: "fomc", event: "FOMC Minutes", time: "2026-07-08T18:00:00Z" },
    { type: "fomc", event: "FOMC Decision", time: "2026-07-29T18:00:00Z" },
  ]);
  assert.equal(events.length, 2);
  assert.equal(events[0]?.event, "FOMC Minutes");
  assert.equal(events[1]?.event, "FOMC Decision");
});

test("parseUwEconomicCalendar maps bare fomc type to FOMC Decision", () => {
  const events = parseUwEconomicCalendar([{ type: "fomc", time: "2026-07-29T18:00:00Z" }]);
  assert.equal(events[0]?.event, "FOMC Decision");
});

// GAP FOUND (Ask Largo standing mandate, 2026-10-11): live `GET /api/market/meridian/timeline?days=14`
// returned 20 duplicate item ids out of 321 (e.g. `macro:2026-10-13:Monthly-Treasury-Balance` twice) —
// the upstream UW economic-calendar feed returns the same (date, event) release more than once for a
// subset of rows, and this parser previously pushed every row 1:1 with no dedup at all.
test("parseUwEconomicCalendar drops an exact-duplicate (date, event) row from the upstream feed", () => {
  const events = parseUwEconomicCalendar([
    { type: "economic", event: "Existing Home Sales", time: "2026-10-13T10:00:00Z", forecast: "4.10M" },
    { type: "economic", event: "Existing Home Sales", time: "2026-10-13T10:00:00Z", forecast: "4.10M" },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.event, "Existing Home Sales");
});

test("parseUwEconomicCalendar keeps two rows with the same event name on DIFFERENT dates — not a duplicate", () => {
  const events = parseUwEconomicCalendar([
    { type: "economic", event: "Existing Home Sales", time: "2026-10-13T10:00:00Z" },
    { type: "economic", event: "Existing Home Sales", time: "2026-11-13T10:00:00Z" },
  ]);
  assert.equal(events.length, 2);
});

test("parseUwEconomicCalendar keeps two DIFFERENT events on the same date — not a duplicate", () => {
  const events = parseUwEconomicCalendar([
    { type: "economic", event: "Existing Home Sales", time: "2026-10-13T10:00:00Z" },
    { type: "economic", event: "NFIB Index of Small Business Optimism", time: "2026-10-13T06:00:00Z" },
  ]);
  assert.equal(events.length, 2);
});
