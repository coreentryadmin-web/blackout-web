import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { inEtWindow } from "@/features/nighthawk/lib/et-window";

/**
 * SCHEDULE-VS-GATE test for banger-discovery.
 *
 * WHY THIS SHAPE. The defect being locked out is invisible for eight months of the year: EventBridge
 * classic Rules fire on a FIXED UTC clock (no timezone support), while this job must run AFTER the
 * 16:00 ET cash close, which moves with daylight saving. The original `15 20 * * 1-5` was 16:15 ET in
 * EDT and 15:15 ET — forty-five minutes BEFORE the close — in EST, where the route screened an
 * unsettled grouped-daily tape and committed positions from it. Nothing failed: the cron fired on
 * time and returned 200.
 *
 * A test that only asserted the GUARD would not survive the real regression, which is someone
 * "tidying" the hour list back to a single UTC hour. So this test reads the SCHEDULE from
 * railway.banger-discovery.toml — the file blackout-infra's sync-cron-schedules.mjs actually
 * generates the deployed manifest from — and asserts the schedule and the guard still agree in BOTH
 * offsets. Touch either side alone and this goes red.
 *
 * Dates are real weekdays in each offset, checked against the America/New_York tz database via the
 * REAL production `inEtWindow` helper (imported, never reimplemented) rather than a hard-coded offset.
 */

/** The route's guard, as configured in src/app/api/cron/banger-discovery/route.ts. */
const BANGER_WINDOW = { targetHour: 16, targetMinute: 15, catchupMin: 90 };

const EDT_WEEKDAY = "2026-08-19"; // Wed, UTC-4
const EST_WEEKDAY = "2027-01-13"; // Wed, UTC-5

/** Parse `cronSchedule = "M H1,H2 * * 1-5"` out of the TOML that feeds the infra generator. */
function scheduledFires(): { minute: number; hours: number[] } {
  const toml = readFileSync(join(process.cwd(), "railway.banger-discovery.toml"), "utf8");
  const expr = /^cronSchedule\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  assert.ok(
    expr,
    "railway.banger-discovery.toml has no `cronSchedule = \"...\"` line. blackout-infra's " +
      "sync-cron-schedules.mjs matches exactly that spelling and SKIPS the file otherwise — a job " +
      "skipped there is absent from the generated manifest and never fires at all."
  );
  const [minF, hourF] = expr!.trim().split(/\s+/);
  return { minute: Number(minF), hours: hourF.split(",").map(Number) };
}

/** ET wall-clock of a UTC fire, formatted, for assertion messages that explain themselves. */
function etOf(day: string, hour: number, minute: number): { at: Date; label: string } {
  const at = new Date(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`);
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
  return { at, label };
}

function firesSatisfyingGuard(day: string) {
  const { minute, hours } = scheduledFires();
  return hours
    .map((h) => ({ h, ...etOf(day, h, minute) }))
    .filter((f) => inEtWindow(BANGER_WINDOW, f.at));
}

// ── The load-bearing assertion: post-close coverage in BOTH offsets ──────────────────────────────

for (const [offset, day] of [
  ["EDT", EDT_WEEKDAY],
  ["EST", EST_WEEKDAY],
] as const) {
  test(`banger-discovery has at least one post-close fire under ${offset}`, () => {
    const hits = firesSatisfyingGuard(day);
    assert.ok(
      hits.length >= 1,
      `No scheduled fire satisfies the post-close ET window under ${offset} (${day}). ` +
        `The job would run zero times that half of the year, or run before the close on an ` +
        `unsettled tape. Schedule TWO adjacent UTC hours so one lands after 16:00 ET in either offset.`
    );
    for (const hit of hits) {
      assert.ok(
        hit.label >= "16:00",
        `${offset}: the ${hit.h}:${BANGER_WINDOW.targetMinute} UTC fire lands at ${hit.label} ET, ` +
          `BEFORE the 16:00 ET close — grouped-daily has not settled and screening it commits ` +
          `positions from a partial session.`
      );
    }
  });
}

// ── The guard must actually reject the off-band fire, or it is decoration ────────────────────────

test("EST root cause: the 20:15 UTC fire is 15:15 ET (pre-close) and is REJECTED", () => {
  const { at, label } = etOf(EST_WEEKDAY, 20, 15);
  assert.equal(label, "15:15", "sanity: 20:15 UTC must be 15:15 ET in January");
  assert.equal(
    inEtWindow(BANGER_WINDOW, at),
    false,
    "The pre-close winter fire must self-skip. This is the exact fire that used to commit banger " +
      "positions from an unsettled session for ~4 months a year."
  );
});

test("EST fix: the 21:15 UTC fire is 16:15 ET and is ACCEPTED", () => {
  const { at, label } = etOf(EST_WEEKDAY, 21, 15);
  assert.equal(label, "16:15");
  assert.equal(inEtWindow(BANGER_WINDOW, at), true);
});

test("EDT: the 20:15 UTC fire is 16:15 ET and is ACCEPTED", () => {
  const { at, label } = etOf(EDT_WEEKDAY, 20, 15);
  assert.equal(label, "16:15");
  assert.equal(inEtWindow(BANGER_WINDOW, at), true);
});

// ── Regression detector: prove this test can SEE the old broken schedule ─────────────────────────

test("the pre-fix single-hour schedule `15 20 * * 1-5` would FAIL under EST", () => {
  // Guards the guard. If a future edit made inEtWindow permissive, every assertion above would pass
  // vacuously and the suite would go green on the broken schedule. This asserts the failure is still
  // detectable, so "all green" continues to mean something.
  const oldScheduleHits = [20]
    .map((h) => etOf(EST_WEEKDAY, h, 15))
    .filter((f) => inEtWindow(BANGER_WINDOW, f.at));
  assert.equal(
    oldScheduleHits.length,
    0,
    "The old single-fire schedule should have ZERO post-close fires under EST. If this now passes, " +
      "the window was widened and the post-close guarantee this job depends on is gone."
  );
});

// ── The schedule must remain dual-band, whatever the hours are ───────────────────────────────────

test("railway.banger-discovery.toml schedules two adjacent UTC hours", () => {
  const { hours } = scheduledFires();
  assert.equal(
    hours.length,
    2,
    `Expected two UTC hours (one per DST offset), got [${hours.join(",")}]. A single fixed-UTC hour ` +
      `cannot land post-close in both EDT and EST — that is the whole defect.`
  );
  assert.equal(hours[1] - hours[0], 1, `The two hours must be adjacent, got [${hours.join(",")}].`);
});
