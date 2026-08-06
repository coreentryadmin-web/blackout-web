import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateDailyToWeekly, isVectorDailyUnit } from "./vector-daily-bars";
import type { VectorOhlcBar } from "./vector-bar-timeframes";

const DAY = 86400;
// 2026-08-03 is a Monday (UTC midnight epoch seconds).
const MON = Date.UTC(2026, 7, 3, 0, 0, 0) / 1000;

function bar(daysFromMon: number, o: number, h: number, l: number, c: number, v: number): VectorOhlcBar {
  return { time: MON + daysFromMon * DAY, open: o, high: h, low: l, close: c, volume: v };
}

test("aggregateDailyToWeekly: empty input returns empty", () => {
  assert.deepEqual(aggregateDailyToWeekly([]), []);
});

test("aggregateDailyToWeekly: one full Mon-Fri week collapses to one bar", () => {
  const week = [
    bar(0, 100, 105, 99, 102, 1000), // Mon
    bar(1, 102, 108, 101, 104, 1100), // Tue
    bar(2, 104, 106, 100, 101, 900), // Wed
    bar(3, 101, 110, 98, 109, 1200), // Thu
    bar(4, 109, 112, 107, 111, 1300), // Fri
  ];
  const out = aggregateDailyToWeekly(week);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.time, MON);
  assert.equal(out[0]!.open, 100); // Monday's open
  assert.equal(out[0]!.close, 111); // Friday's close
  assert.equal(out[0]!.high, 112); // max across the week
  assert.equal(out[0]!.low, 98); // min across the week
  assert.equal(out[0]!.volume, 1000 + 1100 + 900 + 1200 + 1300);
});

test("aggregateDailyToWeekly: a holiday-shortened week (missing Monday) still keys to that week", () => {
  // Tue-Fri only (Monday was a holiday) — should still bucket into the SAME week as a full week,
  // with Tuesday's open standing in for the missing Monday's.
  const shortWeek = [bar(1, 200, 205, 199, 203, 500), bar(4, 203, 210, 200, 208, 600)];
  const out = aggregateDailyToWeekly(shortWeek);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.time, MON);
  assert.equal(out[0]!.open, 200);
  assert.equal(out[0]!.close, 208);
});

test("aggregateDailyToWeekly: two consecutive weeks produce two ascending buckets", () => {
  const bars = [bar(0, 100, 101, 99, 100, 10), bar(7, 100, 103, 98, 102, 20)];
  const out = aggregateDailyToWeekly(bars);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.time, MON);
  assert.equal(out[1]!.time, MON + 7 * DAY);
  assert.ok(out[0]!.time < out[1]!.time);
});

test("aggregateDailyToWeekly: preserves volume=0/undefined without fabricating a sum", () => {
  const bars: VectorOhlcBar[] = [
    { time: MON, open: 1, high: 2, low: 0.5, close: 1.5 }, // no volume field
  ];
  const out = aggregateDailyToWeekly(bars);
  assert.equal(out[0]!.volume, undefined);
});

test("isVectorDailyUnit: accepts only 1D/1W", () => {
  assert.equal(isVectorDailyUnit("1D"), true);
  assert.equal(isVectorDailyUnit("1W"), true);
  assert.equal(isVectorDailyUnit("1H"), false);
  assert.equal(isVectorDailyUnit(5), false);
  assert.equal(isVectorDailyUnit(undefined), false);
});
