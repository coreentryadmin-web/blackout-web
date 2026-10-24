import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { legacyEditionSessionDates } from "@/features/nighthawk/lib/legacy-board-calendar";

// Dead-code cleanup (found 2026-09-16, live audit): legacyEditionCalendarBuckets was an
// always-zero PnL placeholder ("PnL fields are placeholders until record overlay lands") with
// ZERO real callers anywhere in the app and no test ever exercising it — the record overlay it
// was waiting for landed as a differently-named, fully real, actively-maintained sibling instead
// (legacyBoardCalendarBuckets in legacy-board-table-utils.ts, wired into LegacyPickLogBoard.tsx),
// leaving the old placeholder orphaned. The near-identical name (Edition vs Board) made it a real
// footgun for a future reader/grep to wire up the wrong one. Deleted; this asserts it stays gone.
test("legacy-board-calendar.ts no longer exports the dead legacyEditionCalendarBuckets placeholder", () => {
  const src = readFileSync(
    join(process.cwd(), "src/features/nighthawk/lib/legacy-board-calendar.ts"),
    "utf8"
  );
  assert.doesNotMatch(src, /legacyEditionCalendarBuckets/);
  assert.doesNotMatch(src, /VectorBoardCalendarBucket/);
});

// ── legacyEditionSessionDates anchored on literal wall-clock "now", but Legacy's fresh evening
// edition is tagged editionFor = nextTradingDayEt(todayEt()) — one calendar day ahead for the
// whole evening-to-midnight-ET window. That meant the freshest edition's rows (sessionDate =
// editionFor) never matched any date this function returned, silently dropping them from the
// entire calendar strip even though the pick table above it rendered them correctly. Live
// evidence, 2026-09-10 ~7:30pm ET: editionFor="2026-09-11" (AAPL/SWKS), but the calendar strip
// topped out at "2026-09-10". ─────────────────────────────────────────────────────────────────

test("legacyEditionSessionDates includes tomorrow's date on a regular weekday evening (Thu -> Fri)", () => {
  // 2026-09-10 23:30 UTC ~= Thursday 7:30pm ET.
  const nowMs = new Date("2026-09-10T23:30:00Z").getTime();
  const dates = legacyEditionSessionDates(5, nowMs);
  assert.equal(dates[dates.length - 1], "2026-09-11", "the next trading day (Fri) must be the most recent tile");
});

test("legacyEditionSessionDates correctly skips the weekend (Fri evening -> Mon)", () => {
  // 2026-09-11 is a Friday (not adjacent to a holiday, unlike 2026-09-04 -> Mon 9/7 = Labor Day);
  // 2026-09-11 23:30 UTC ~= Friday 7:30pm ET.
  const nowMs = new Date("2026-09-11T23:30:00Z").getTime();
  const dates = legacyEditionSessionDates(5, nowMs);
  assert.equal(dates[dates.length - 1], "2026-09-14", "next trading day after a Friday evening is Monday, not Sat/Sun");
  assert.ok(!dates.includes("2026-09-12") && !dates.includes("2026-09-13"), "no weekend tiles");
});

test("legacyEditionSessionDates still returns `count` weekday sessions ending at the anchor", () => {
  const nowMs = new Date("2026-09-10T23:30:00Z").getTime();
  const dates = legacyEditionSessionDates(5, nowMs);
  assert.equal(dates.length, 5);
  assert.deepEqual(dates, ["2026-09-04", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]);
});

test("legacyEditionSessionDates skips a NYSE market holiday, not just weekends (2026-09-14 fix)", () => {
  // 2026-09-07 is Labor Day (a real NYSE closure) -- no edition ever published that day, so it
  // must never appear as a session tile. The window still walks back far enough to return the
  // full `count` of REAL trading days rather than silently returning fewer than requested.
  const nowMs = new Date("2026-09-10T23:30:00Z").getTime();
  const dates = legacyEditionSessionDates(5, nowMs);
  assert.ok(!dates.includes("2026-09-07"), "Labor Day must not appear as a calendar tile");
  assert.equal(dates.length, 5, "still returns the full requested count by walking one extra day back");
});
