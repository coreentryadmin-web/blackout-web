import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateMinuteTo4h } from "./vector-4h-bars";
import type { VectorOhlcBar } from "./vector-bar-timeframes";

// 2026-01-05 is a Monday in EST (UTC-5, outside DST) so the UTC math below is easy to check
// by hand: ET hour = UTC hour - 5.
function etEpoch(y: number, m: number, d: number, etHour: number, etMinute = 0): number {
  return Date.UTC(y, m - 1, d, etHour + 5, etMinute, 0) / 1000;
}

function bar(time: number, o: number, h: number, l: number, c: number, v?: number): VectorOhlcBar {
  return { time, open: o, high: h, low: l, close: c, ...(v != null ? { volume: v } : {}) };
}

test("aggregateMinuteTo4h: empty input returns empty", () => {
  assert.deepEqual(aggregateMinuteTo4h([]), []);
});

test("aggregateMinuteTo4h: bars within the same real ET 4h window collapse to one bucket at the boundary", () => {
  // ET 09:31, 09:45, 11:59 all fall in the 08:00-12:00 ET bucket.
  const bars = [
    bar(etEpoch(2026, 1, 5, 9, 31), 100, 101, 99, 100.5, 10),
    bar(etEpoch(2026, 1, 5, 9, 45), 100.5, 102, 100, 101, 20),
    bar(etEpoch(2026, 1, 5, 11, 59), 101, 103, 100.5, 102, 30),
  ];
  const out = aggregateMinuteTo4h(bars);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.time, etEpoch(2026, 1, 5, 8, 0), "bucket key must be the 08:00 ET boundary");
  assert.equal(out[0]!.open, 100); // first bar's open
  assert.equal(out[0]!.close, 102); // last bar's close
  assert.equal(out[0]!.high, 103);
  assert.equal(out[0]!.low, 99);
  assert.equal(out[0]!.volume, 10 + 20 + 30);
});

test("aggregateMinuteTo4h: a bar just after a boundary starts a NEW bucket", () => {
  const bars = [
    bar(etEpoch(2026, 1, 5, 11, 59), 100, 100, 100, 100, 1), // 08:00-12:00 bucket
    bar(etEpoch(2026, 1, 5, 12, 1), 101, 101, 101, 101, 2), // 12:00-16:00 bucket
  ];
  const out = aggregateMinuteTo4h(bars);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.time, etEpoch(2026, 1, 5, 8, 0));
  assert.equal(out[1]!.time, etEpoch(2026, 1, 5, 12, 0));
});

test("aggregateMinuteTo4h: the same wall-clock window on two different days buckets separately", () => {
  const bars = [
    bar(etEpoch(2026, 1, 5, 9, 30), 100, 100, 100, 100, 5), // Monday
    bar(etEpoch(2026, 1, 6, 9, 30), 105, 105, 105, 105, 6), // Tuesday
  ];
  const out = aggregateMinuteTo4h(bars);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.time, etEpoch(2026, 1, 5, 8, 0));
  assert.equal(out[1]!.time, etEpoch(2026, 1, 6, 8, 0));
  assert.ok(out[0]!.time < out[1]!.time);
});

test("aggregateMinuteTo4h: preserves volume=undefined without fabricating a sum (SPX has no native tape volume)", () => {
  const bars = [bar(etEpoch(2026, 1, 5, 9, 30), 1, 2, 0.5, 1.5)];
  const out = aggregateMinuteTo4h(bars);
  assert.equal(out[0]!.volume, undefined);
});

test("aggregateMinuteTo4h: also buckets correctly during EDT (DST) — offset is read per-instant, not a fixed UTC delta", () => {
  // 2026-07-06 is a Monday in EDT (UTC-4). ET hour = UTC hour - 4.
  const utcEpoch = (h: number, min: number) => Date.UTC(2026, 6, 6, h, min, 0) / 1000;
  const bars = [
    bar(utcEpoch(13, 31), 100, 100, 100, 100, 1), // ET 09:31 -> 08:00-12:00 bucket
    bar(utcEpoch(17, 5), 101, 101, 101, 101, 2), // ET 13:05 -> 12:00-16:00 bucket
  ];
  const out = aggregateMinuteTo4h(bars);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.time, utcEpoch(12, 0)); // ET 08:00 == UTC 12:00 in EDT
  assert.equal(out[1]!.time, utcEpoch(16, 0)); // ET 12:00 == UTC 16:00 in EDT
});
