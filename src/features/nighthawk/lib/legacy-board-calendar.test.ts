import assert from "node:assert/strict";
import { test } from "node:test";
import { legacyEditionSessionDates } from "@/features/nighthawk/lib/legacy-board-calendar";

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
  assert.deepEqual(dates, ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]);
});
