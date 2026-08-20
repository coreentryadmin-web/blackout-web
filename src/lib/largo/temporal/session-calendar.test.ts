import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyEtDay,
  formatSessionCalendarBlock,
  upcomingSessions,
  weekdayEt,
} from "./session-calendar";

/**
 * THE PRODUCTION FAILURE, pinned.
 *
 * A member asked "how is SPX looking for 8/23? what is a good play?" on Thursday 2026-08-20.
 * Largo replied "For 8/23 (Friday, 3 DTE into the close)" and built an entire thesis — walls,
 * invalidation, "into Friday close" — on it.
 *
 * 2026-08-23 is a SUNDAY. There is no 8/23 SPX expiry.
 *
 * The turn block supplied only `Session date (ET): 2026-08-20`, so the weekday was left to
 * inference and nothing in the prompt could contradict the guess. These tests pin the data that
 * makes the guess unnecessary.
 */

test("REGRESSION: 2026-08-23 is a Sunday, not a Friday", () => {
  assert.equal(weekdayEt("2026-08-23"), "Sunday");
  assert.equal(classifyEtDay("2026-08-23").kind, "weekend");
});

test("weekdayEt is not shifted by the UTC-midnight parsing trap", () => {
  // `new Date("2026-08-23")` is UTC midnight, which is 2026-08-22 20:00 in ET — so a naive
  // implementation reports Saturday for every date. The noon anchor is what prevents that.
  assert.equal(weekdayEt("2026-08-20"), "Thursday");
  assert.equal(weekdayEt("2026-08-21"), "Friday");
  assert.equal(weekdayEt("2026-08-24"), "Monday");
});

test("classifyEtDay separates weekend from holiday", () => {
  assert.equal(classifyEtDay("2026-08-20").kind, "trading");
  assert.equal(classifyEtDay("2026-08-22").kind, "weekend");
  // Labor Day 2026 — a Monday in the NYSE table, so it can only be caught by the holiday set.
  assert.equal(classifyEtDay("2026-09-07").kind, "holiday");
  assert.equal(weekdayEt("2026-09-07"), "Monday");
});

test("upcomingSessions skips the weekend and reports what it skipped", () => {
  const { trading, skipped } = upcomingSessions("2026-08-20", 3);
  assert.deepEqual(
    trading.map((d) => d.ymd),
    ["2026-08-21", "2026-08-24", "2026-08-25"]
  );
  // The skipped half is the load-bearing part: it is what tells the model 8/22 and 8/23 exist as
  // calendar dates but not as sessions.
  assert.deepEqual(
    skipped.map((d) => d.ymd),
    ["2026-08-22", "2026-08-23"]
  );
  assert.ok(skipped.every((d) => d.kind === "weekend"));
});

test("upcomingSessions walks a holiday week without stalling", () => {
  // Labor Day Monday 2026-09-07 must be skipped, not returned as a session.
  const { trading, skipped } = upcomingSessions("2026-09-04", 2);
  assert.deepEqual(
    trading.map((d) => d.ymd),
    ["2026-09-08", "2026-09-09"]
  );
  assert.ok(
    skipped.some((d) => d.ymd === "2026-09-07" && d.kind === "holiday"),
    "Labor Day must be reported as a skipped holiday"
  );
});

test("the block states today's weekday, the sessions, and the non-sessions", () => {
  const block = formatSessionCalendarBlock("2026-08-20", 3);
  assert.match(block, /Session date \(ET\): 2026-08-20 \(Thursday\)/);
  assert.match(block, /2026-08-21 \(Friday\)/);
  // The exact date that was hallucinated must appear, labelled as a weekend.
  assert.match(block, /2026-08-23 \(Sunday\) — weekend/);
});

test("the block carries an instruction, not just data", () => {
  // Supplying the calendar without saying what to do with it still permits "8/23 (Friday)".
  // The model has to be told a member-named date is a claim to CHECK, not a premise to accept.
  const block = formatSessionCalendarBlock("2026-08-20");
  assert.match(block, /DATE RULE/);
  assert.match(block, /never build a thesis/i);
  assert.match(block, /Never infer a weekday/i);
});

test("a non-trading 'today' is labelled as such", () => {
  // The desk runs over weekends; the member sees Largo on a Sunday. Reporting a Sunday as a
  // plain session date is the same class of error as the original bug.
  const block = formatSessionCalendarBlock("2026-08-23", 2);
  assert.match(block, /2026-08-23 \(Sunday\) — NOT a trading day \(weekend\)/);
  assert.match(block, /2026-08-24 \(Monday\)/);
});
