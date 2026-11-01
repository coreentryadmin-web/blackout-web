import { test } from "node:test";
import assert from "node:assert/strict";
import { dailyRegimeWalkWindow } from "./vector-daily-regime-window";

test("dailyRegimeWalkWindow resolves todayYmd from the ET trading date, not a UTC calendar slice", (t) => {
  // 2026-07-16T02:00:00Z is 2026-07-15T22:00:00 ET (EDT, UTC-4) — inside the ~19:00-23:59 ET
  // window where UTC has already rolled to the next calendar day while the ET session is still
  // "today". This is exactly the instant that broke the old `new Date().toISOString().slice(0,10)`
  // computation in loadDailyRegime (vector-daily-regime-server.ts).
  const now = Date.parse("2026-07-16T02:00:00.000Z");
  t.mock.timers.enable({ apis: ["Date"], now });

  // Sanity: confirm the fake clock really is mid-rollover, so this test is proving something real
  // rather than accidentally picking a moment where UTC and ET agree.
  const utcSlice = new Date().toISOString().slice(0, 10);
  assert.equal(utcSlice, "2026-07-16", "fixture clock must be UTC-ahead-of-ET at this instant");

  const { todayYmd, ymds } = dailyRegimeWalkWindow(3);

  // The bug: a UTC-derived todayYmd would read "2026-07-16" here, one day ahead of the real ET
  // trading day. The fix must report the ET date instead.
  assert.equal(todayYmd, "2026-07-15");
  assert.notEqual(todayYmd, utcSlice, "todayYmd must not equal the UTC-ahead calendar date");

  // ymds[0] is "today" (0 days back) and must equal todayYmd exactly — this is the invariant
  // loadSessionWallTail's `sessionYmd < todayYmd` settled-check relies on: if ymds[0] !== todayYmd,
  // today's own session is misclassified as a day already in the past (or vice versa).
  assert.deepEqual(ymds, ["2026-07-15", "2026-07-14", "2026-07-13"]);
  assert.equal(ymds[0], todayYmd);
});

test("dailyRegimeWalkWindow agrees with the UTC calendar when there is no DST/midnight skew", (t) => {
  // A midday UTC instant has no ET/UTC calendar-day disagreement, so this should look boring —
  // confirming the fix doesn't just happen to pass the skewed case while breaking the normal one.
  const now = Date.parse("2026-07-15T16:00:00.000Z"); // 12:00 ET
  t.mock.timers.enable({ apis: ["Date"], now });

  const { todayYmd, ymds } = dailyRegimeWalkWindow(2);
  assert.equal(todayYmd, "2026-07-15");
  assert.deepEqual(ymds, ["2026-07-15", "2026-07-14"]);
});
