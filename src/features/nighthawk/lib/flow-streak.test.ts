import assert from "node:assert/strict";
import { test } from "node:test";
import { computeFlowStreakFromBuckets } from "./flow-streak.ts";
import { formatEtDate, isTradingDayEt } from "./session.ts";

// flow-streak.ts had zero test coverage anywhere in the repo before this file, despite its own
// comment documenting a previously-fixed MEDIUM-severity bug (non-consecutive days silently
// counted as a streak) and stating the streak drives a real x1.7 candidate multiplier and up to
// +12 scorer points -- exactly the kind of logic where a silent regression is costly. This is a
// pure coverage addition, not a bug fix: the logic was hand-verified correct against the fixed
// code before writing any test, and every assertion below locks in already-correct behavior.

/** Walk back N REAL trading days (skipping weekends/holidays) from a real anchor date, so
 *  fixtures never accidentally land on a weekend/holiday regardless of when this suite runs. */
function tradingDaysBack(anchorYmd: string, n: number): string[] {
  const days: string[] = [];
  let cursor = new Date(`${anchorYmd}T12:00:00`);
  while (days.length < n) {
    const ymd = formatEtDate(cursor);
    if (isTradingDayEt(ymd)) days.push(ymd);
    cursor = new Date(cursor.getTime() - 86_400_000);
  }
  return days;
}

// A real, far-from-any-holiday anchor (mid-September, ordinary trading week).
const [D0, D1, D2, D3, D4] = tradingDaysBack("2026-09-17", 5);

function bucket(day: string, net: number) {
  return { day, net, call: net > 0 ? net : 0, put: net < 0 ? -net : 0 };
}

test("empty buckets → zero streak, mixed direction, no fabricated data", () => {
  const r = computeFlowStreakFromBuckets([]);
  assert.deepEqual(r, { streak_days: 0, net_3d: 0, net_5d: 0, direction: "mixed" });
});

test("single call-heavy day → 1-day long streak", () => {
  const r = computeFlowStreakFromBuckets([bucket(D0, 500_000)]);
  assert.equal(r.streak_days, 1);
  assert.equal(r.direction, "long");
});

test("single put-heavy day → 1-day short streak", () => {
  const r = computeFlowStreakFromBuckets([bucket(D0, -500_000)]);
  assert.equal(r.streak_days, 1);
  assert.equal(r.direction, "short");
});

test("a net-zero day never counts as a streak, even as the only bucket", () => {
  const r = computeFlowStreakFromBuckets([bucket(D0, 0)]);
  assert.equal(r.streak_days, 0);
});

test("three CONSECUTIVE same-direction trading days → streak_days=3", () => {
  const r = computeFlowStreakFromBuckets([
    bucket(D0, 300_000),
    bucket(D1, 200_000),
    bucket(D2, 100_000),
  ]);
  assert.equal(r.streak_days, 3);
  assert.equal(r.direction, "long");
});

test("audit-fixed regression: a GAP day (missing from the DB GROUP BY, not zero) breaks the streak instead of being silently skipped", () => {
  // D0 and D2 are same-direction, but D1 (the trading day directly between them) has NO row at
  // all -- exactly the "DB GROUP BY only emits days that had flow" case the file's own header
  // comment describes as the audit-fixed bug. The old buggy code counted entries regardless of
  // day-adjacency and would have read this as a 2-day streak.
  const r = computeFlowStreakFromBuckets([bucket(D0, 300_000), bucket(D2, 250_000)]);
  assert.equal(r.streak_days, 1, "streak must stop at the gap, not silently bridge it");
});

test("a direction flip breaks the streak at the flip point", () => {
  const r = computeFlowStreakFromBuckets([
    bucket(D0, 300_000),
    bucket(D1, 200_000),
    bucket(D2, -400_000), // flips short
    bucket(D3, -100_000),
  ]);
  assert.equal(r.streak_days, 2);
  assert.equal(r.direction, "long");
});

test("a net-zero day in the middle of an otherwise-consecutive run stops the streak there", () => {
  const r = computeFlowStreakFromBuckets([
    bucket(D0, 300_000),
    bucket(D1, 0),
    bucket(D2, 200_000),
  ]);
  assert.equal(r.streak_days, 1);
});

test("weekend gap does NOT break the streak -- Monday's prior trading day is Friday", () => {
  // Walk forward from a real trading day to the next real Monday, then take its real prior
  // trading day (Friday, skipping the weekend) -- both derived from the real calendar/holiday
  // helpers, never hardcoded, so this can't accidentally land on a holiday week.
  const weekdayOf = (ymd: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(
      new Date(`${ymd}T12:00:00`)
    );
  let monday = D0;
  while (weekdayOf(monday) !== "Mon") {
    monday = formatEtDate(new Date(new Date(`${monday}T12:00:00`).getTime() + 86_400_000));
  }
  const friday = tradingDaysBack(monday, 2)[1]!; // [0]=monday itself, [1]=its prior trading day
  const r = computeFlowStreakFromBuckets([bucket(monday, 100_000), bucket(friday, 150_000)]);
  assert.equal(weekdayOf(friday), "Fri");
  assert.equal(r.streak_days, 2, "Mon -> Fri must chain as consecutive trading days");
});

test("net_3d and net_5d sum the first 3/5 buckets regardless of streak continuity", () => {
  // Buckets 0 and 2 form a broken streak (gap at D1), but net_3d/net_5d must still sum
  // whatever rows are present in the first 3/5 slots -- they measure raw net flow, not streak.
  const r = computeFlowStreakFromBuckets([
    bucket(D0, 100_000),
    bucket(D2, -50_000),
    bucket(D3, 25_000),
    bucket(D4, 10_000),
  ]);
  assert.equal(r.net_3d, 100_000 - 50_000 + 25_000);
  assert.equal(r.net_5d, 100_000 - 50_000 + 25_000 + 10_000);
});
