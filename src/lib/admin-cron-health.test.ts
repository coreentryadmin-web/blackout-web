import assert from "node:assert/strict";
import test from "node:test";

import { evaluateJob, expectedNighthawkEdition, nighthawkEditionCoversExpected } from "./admin-cron-health";
import type { CronJobDefinition } from "./cron-registry";

function withDefaultNighthawkWindow(fn: () => void) {
  const prevHour = process.env.NIGHTHAWK_EDITION_HOUR_ET;
  const prevMinute = process.env.NIGHTHAWK_EDITION_MINUTE_ET;
  const prevCatchup = process.env.NIGHTHAWK_EDITION_CATCHUP_MIN;
  delete process.env.NIGHTHAWK_EDITION_HOUR_ET;
  delete process.env.NIGHTHAWK_EDITION_MINUTE_ET;
  delete process.env.NIGHTHAWK_EDITION_CATCHUP_MIN;
  try {
    fn();
  } finally {
    if (prevHour === undefined) delete process.env.NIGHTHAWK_EDITION_HOUR_ET;
    else process.env.NIGHTHAWK_EDITION_HOUR_ET = prevHour;
    if (prevMinute === undefined) delete process.env.NIGHTHAWK_EDITION_MINUTE_ET;
    else process.env.NIGHTHAWK_EDITION_MINUTE_ET = prevMinute;
    if (prevCatchup === undefined) delete process.env.NIGHTHAWK_EDITION_CATCHUP_MIN;
    else process.env.NIGHTHAWK_EDITION_CATCHUP_MIN = prevCatchup;
  }
}

test("Night Hawk health expects today's edition before the evening deadline", () => {
  withDefaultNighthawkWindow(() => {
    const expectation = expectedNighthawkEdition(new Date("2026-06-30T08:04:00Z"));

    assert.equal(expectation.et_date, "2026-06-30");
    assert.equal(expectation.expected_edition_for, "2026-06-30");
    assert.equal(expectation.after_deadline, false);
    assert.equal(nighthawkEditionCoversExpected("2026-06-30", expectation), true);
  });
});

test("Night Hawk health expects the next trading day after the evening deadline", () => {
  withDefaultNighthawkWindow(() => {
    const expectation = expectedNighthawkEdition(new Date("2026-06-30T23:31:00Z"));

    assert.equal(expectation.et_date, "2026-06-30");
    assert.equal(expectation.expected_edition_for, "2026-07-01");
    assert.equal(expectation.after_deadline, true);
    assert.equal(nighthawkEditionCoversExpected("2026-06-30", expectation), false);
    assert.equal(nighthawkEditionCoversExpected("2026-07-01", expectation), true);
  });
});

test("Night Hawk health carries the next trading edition across a market holiday", () => {
  withDefaultNighthawkWindow(() => {
    const expectation = expectedNighthawkEdition(new Date("2026-07-03T16:00:00Z"));

    assert.equal(expectation.et_date, "2026-07-03");
    assert.equal(expectation.expected_edition_for, "2026-07-06");
    assert.equal(expectation.after_deadline, false);
  });
});

// ---------------------------------------------------------------------------
// A cron that has NEVER logged a run must not read as "unknown" on the board.
//
// Live on 2026-08-19: `helix-signal-outcomes` and `largo-morning-brief` had no entry in
// blackout-infra's cron-jobs.json, so production had never invoked either. `/api/brief/premarket`
// was serving `available: false, staleDate: "2026-06-29"` — 51 days cold — and the health board
// still reported them as `unknown` with a summary of `stale: 0, failed: 0, market_hours_stale: 0`.
// The watchdog was blind to the one failure it exists to catch.
//
// Every case below injects `now`, because each branch turns on where the clock sits relative to the
// market session. A real-clock test here would pass during RTH and fail overnight — a date bomb
// inside the check meant to catch things going dark.
// ---------------------------------------------------------------------------

/** 2026-08-19 is a Wednesday. EDT is UTC-4, so 18:00Z is 14:00 ET — mid-session. */
const RTH_WEDNESDAY = new Date("2026-08-19T18:00:00Z");
/** Same Wednesday at 03:00 ET — the market is shut and a market-hours job is not due. */
const OVERNIGHT_WEDNESDAY = new Date("2026-08-19T07:00:00Z");

function jobDef(over: Partial<CronJobDefinition> = {}): CronJobDefinition {
  return {
    key: "test-job",
    name: "Test Job",
    kind: "http",
    path: "/api/cron/test-job",
    schedule_label: "Hourly",
    stale_after_min: 60,
    description: "fixture",
    ...over,
  };
}

test("a job that has NEVER logged a run reports stale, not unknown", () => {
  const health = evaluateJob(jobDef(), undefined, [], RTH_WEDNESDAY);
  assert.equal(health.status, "stale");
  assert.match(health.status_label, /NEVER/i);
  assert.equal(health.last_run_at, null);
});

test("a never-run MARKET-HOURS job trips market_hours_stale during RTH", () => {
  // This is the exact shape of the live outage: a market-hours job with no schedule at all.
  const health = evaluateJob(
    jobDef({ key: "helix-signal-outcomes", market_hours_only: true, stale_after_min: 45 }),
    undefined,
    [],
    RTH_WEDNESDAY
  );
  assert.equal(health.status, "stale");
  assert.equal(health.market_hours_stale, true, "a dead market-hours job during RTH must trip the #90 flag");
});

test("a never-run market-hours job stays quiet overnight — it is not due yet", () => {
  // The off-window suppression exists so the board does not cry wolf at 3am; a job that has never
  // run gets the same benefit of the doubt a stale-but-present one does, and no more.
  const health = evaluateJob(
    jobDef({ market_hours_only: true }),
    undefined,
    [],
    OVERNIGHT_WEDNESDAY
  );
  assert.equal(health.status, "unknown");
  assert.equal(health.market_hours_stale, false);
});

test("REGRESSION: a job WITH a fresh run is untouched by the never-run branch", () => {
  const health = evaluateJob(
    jobDef(),
    {
      id: 1,
      job_key: "test-job",
      status: "ok",
      // 5 minutes before the injected `now`, well inside the 60-minute window.
      started_at: new Date(RTH_WEDNESDAY.getTime() - 5 * 60_000).toISOString(),
      duration_ms: 120,
      message: null,
      meta_json: null,
    },
    [],
    RTH_WEDNESDAY
  );
  assert.equal(health.status, "healthy");
  assert.equal(health.market_hours_stale, false);
});
