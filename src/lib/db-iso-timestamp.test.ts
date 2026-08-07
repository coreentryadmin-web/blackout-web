import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isoTimestampString } from "@/lib/db";

// The exact string production served on 2026-08-07 from GET /api/admin/zerodte/funnel, on every one
// of the 500 `raw_rejections` rows. Reproducing the defect from the captured value (rather than a
// synthetic Date) is what makes this a regression test rather than a restatement of the fix.
const SERVED_LIVE = "Fri Aug 07 2026 17:31:36 GMT+0000 (Coordinated Universal Time)";

test("REGRESSION: String(pgTimestamptz) is what production actually served", () => {
  // node-postgres hands TIMESTAMPTZ back as a JS Date, so the old `String(r.observed_at)` ran
  // Date.prototype.toString(). Pinned so nobody reintroduces the coercion without seeing this.
  const fromPg = new Date("2026-08-07T17:31:36.000Z");
  assert.equal(String(fromPg), SERVED_LIVE, "precondition: reproduce the exact live serialization");
  assert.doesNotMatch(String(fromPg), /^\d{4}-\d{2}-\d{2}T/, "pre-fix: the wire value was not ISO 8601");
});

test("a pg Date becomes ISO 8601 with an explicit UTC offset", () => {
  assert.equal(isoTimestampString(new Date("2026-08-07T17:31:36.000Z")), "2026-08-07T17:31:36.000Z");
});

test("sub-second precision survives — the ordering key Date.toString() silently dropped", () => {
  // The 0DTE scanner writes on a ~5s cadence (1287 gate_blocked events on 2026-08-07). Two rows
  // inside the same second are ordered in the DB; the old wire format could not express that.
  const a = new Date("2026-08-07T17:31:36.120Z");
  const b = new Date("2026-08-07T17:31:36.880Z");
  assert.equal(String(a), String(b), "pre-fix: both rows collapsed to the same wire string");
  assert.notEqual(isoTimestampString(a), isoTimestampString(b), "post-fix: they stay distinguishable");
  assert.equal(isoTimestampString(a), "2026-08-07T17:31:36.120Z");
});

test("lexicographic order IS chronological order — the property Date.toString() inverts", () => {
  // Sorting a field the type says is `string` is the obvious client-side move. On the old format it
  // ordered by weekday NAME, silently scrambling the chronology.
  const chronological = [
    new Date("2026-08-03T14:00:00.000Z"), // Monday
    new Date("2026-08-07T14:00:00.000Z"), // Friday
    new Date("2026-08-08T14:00:00.000Z"), // Saturday
  ];
  const legacySorted = chronological.map(String).sort();
  assert.notDeepEqual(legacySorted, chronological.map(String), "pre-fix: lexicographic sort reorders");
  assert.equal(legacySorted[0]!.slice(0, 3), "Fri", "pre-fix: Friday sorts before Monday");

  const isoSorted = chronological.map((d) => isoTimestampString(d)).sort();
  assert.deepEqual(isoSorted, chronological.map((d) => isoTimestampString(d)));
});

test("the legacy stringified-Date shape is recovered, not passed through", () => {
  // Any row already read through an older code path (or a cached payload) still normalizes.
  assert.equal(isoTimestampString(SERVED_LIVE), "2026-08-07T17:31:36.000Z");
});

test("an already-ISO string is idempotent", () => {
  assert.equal(isoTimestampString("2026-08-07T17:31:36.000Z"), "2026-08-07T17:31:36.000Z");
});

test("absent stays absent — null/undefined/garbage never become the truthy string 'null'", () => {
  assert.equal(isoTimestampString(null), null);
  assert.equal(isoTimestampString(undefined), null);
  assert.equal(isoTimestampString(""), null);
  assert.equal(isoTimestampString("not a date"), null);
  assert.equal(isoTimestampString(new Date("nope")), null, "an Invalid Date is absent, not 'Invalid Date'");
});

test("BLAST RADIUS: Largo's Thermal read prints a clock time again, not the year", () => {
  // src/lib/bie/thermal-read.ts:54 renders each GEX regime transition as
  // `${e.observed_at?.slice(11, 16)}` — an HH:MM slice that is only correct on an ISO 8601 string.
  // That field comes from fetchGexRegimeEvents -> fetchGexRegimeEventRows, i.e. one of the mappers
  // fixed here, so it was slicing the stringified-Date form and printing the YEAR where the time
  // belongs. This consumer already ASSUMED the ISO contract; the mapper is what broke it.
  const HHMM = (s: string) => s.slice(11, 16);
  assert.equal(HHMM(SERVED_LIVE), "2026 ", "pre-fix: the 'clock time' was the year plus a space");
  assert.equal(HHMM(isoTimestampString(SERVED_LIVE)!), "17:31", "post-fix: a real HH:MM");
});

test("no db.ts row mapper still coerces an instant column with a bare String()", () => {
  // Source-pinned because these mappers need a live pool to exercise. This is the check that would
  // have caught the bug: the fix is only durable if the pattern cannot come back at a NEW call site.
  const src = readFileSync("src/lib/db.ts", "utf8");
  const INSTANT_COLUMNS = [
    "observed_at",
    "as_of",
    "first_seen",
    "last_seen",
    "detected_at",
    "armed_at",
    "triggered_at",
    "invalidated_at",
    "opened_at",
  ];
  for (const col of INSTANT_COLUMNS) {
    // Matches both mapper shapes: `col: String(r.col),` and `col: r.col != null ? String(r.col) : null,`.
    const bare = new RegExp(`${col}:\\s*(r\\.${col} != null \\? )?String\\(r\\.${col}\\)`);
    assert.doesNotMatch(src, bare, `${col} must go through isoTimestampString, not a bare String()`);
  }
  // DATE columns have their own documented funnel; neither may fall back to String().
  assert.doesNotMatch(src, /session_date:\s*String\(r\.session_date\)/, "DATE columns use isoDateString");
});
