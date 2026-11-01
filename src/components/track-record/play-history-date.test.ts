import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPlayHistoryDate } from "./play-history-date.ts";

/**
 * Regression for the PlayHistoryTable.tsx date-off-by-one-day bug: `session_date`/
 * `edition_for` arrive as bare `YYYY-MM-DD` strings (Postgres DATE columns via
 * db.ts's isoDateString()). `new Date("2026-01-15")` parses as UTC MIDNIGHT (ECMA-262
 * date-only string rule), so formatting it via `toLocaleDateString` in a viewer timezone
 * BEHIND UTC — every US timezone, which is where this admin panel is always opened from on a
 * product that is itself ET-anchored — rolls the displayed date back to the PREVIOUS
 * calendar day.
 */
function withTz<T>(tz: string, fn: () => T): T {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
}

test("formatPlayHistoryDate renders the DB calendar date, not the previous day, in US Eastern (standard time)", () => {
  // 2026-01-15 is in EST (UTC-5) — well clear of any DST edge, so the only variable under
  // test is the UTC-midnight-vs-local-render bug, not a DST transition.
  const out = withTz("America/New_York", () => formatPlayHistoryDate("2026-01-15"));
  assert.equal(out, "Jan 15, 26");
});

test("formatPlayHistoryDate renders the DB calendar date in US Eastern (daylight time)", () => {
  // 2026-07-15 is in EDT (UTC-4) — a different offset, same bug class, so this is not a
  // single-offset coincidence.
  const out = withTz("America/New_York", () => formatPlayHistoryDate("2026-07-15"));
  assert.equal(out, "Jul 15, 26");
});

test("formatPlayHistoryDate renders correctly in a timezone AHEAD of UTC too", () => {
  // A timezone ahead of UTC never exhibited this bug (UTC midnight is still "today" or later
  // locally), but must keep working once a general noon-anchor fix is applied.
  const out = withTz("Asia/Tokyo", () => formatPlayHistoryDate("2026-01-15"));
  assert.equal(out, "Jan 15, 26");
});

test("formatPlayHistoryDate: null input renders the empty-state dash", () => {
  assert.equal(formatPlayHistoryDate(null), "—");
});

test("formatPlayHistoryDate: unparseable input is returned verbatim rather than crashing", () => {
  assert.equal(formatPlayHistoryDate("not-a-date"), "not-a-date");
});
