import { test } from "node:test";
import assert from "node:assert/strict";
import { pickSessionBars, toVectorBars, type RawAggBar } from "./vector-initial-bars";

// Noon UTC keeps every timestamp comfortably inside the same ET calendar date year-round,
// regardless of DST, so date-boundary math in the module under test isn't accidentally
// exercised by the fixture itself.
const JAN5_NOON_UTC = Date.UTC(2026, 0, 5, 12, 0, 0);
const JAN6_NOON_UTC = Date.UTC(2026, 0, 6, 12, 0, 0);

test("toVectorBars maps raw agg bars to lightweight-charts bars, seconds-scaled", () => {
  const bars: RawAggBar[] = [{ t: JAN5_NOON_UTC, o: 100, h: 110, l: 90, c: 105 }];
  assert.deepEqual(toVectorBars(bars), [
    { time: Math.floor(JAN5_NOON_UTC / 1000), open: 100, high: 110, low: 90, close: 105 },
  ]);
});

test("toVectorBars drops bars with a non-number timestamp or a non-positive open", () => {
  const bars: RawAggBar[] = [
    { t: JAN5_NOON_UTC, o: 100, h: 110, l: 90, c: 105 },
    { t: "not-a-number", o: 100, h: 110, l: 90, c: 105 },
    { t: JAN6_NOON_UTC, o: 0, h: 110, l: 90, c: 105 },
  ];
  assert.equal(toVectorBars(bars).length, 1);
});

test("pickSessionBars returns today's bars unmodified when today has any", () => {
  const todayBars: RawAggBar[] = [{ t: JAN6_NOON_UTC, o: 100, h: 110, l: 90, c: 105 }];
  const fallbackBars: RawAggBar[] = [{ t: JAN5_NOON_UTC, o: 1, h: 1, l: 1, c: 1 }];
  const result = pickSessionBars(todayBars, fallbackBars);
  assert.deepEqual(result, toVectorBars(todayBars));
});

test("pickSessionBars returns an empty chart (not an error) when both today and the fallback are empty", () => {
  assert.deepEqual(pickSessionBars([], []), []);
});

test("pickSessionBars falls back to the prior session's bars when today has none yet", () => {
  const fallbackBars: RawAggBar[] = [
    { t: JAN5_NOON_UTC, o: 100, h: 110, l: 90, c: 105 },
    { t: JAN5_NOON_UTC + 60_000, o: 105, h: 112, l: 100, c: 108 },
  ];
  const result = pickSessionBars([], fallbackBars);
  assert.deepEqual(result, toVectorBars(fallbackBars));
});

test("pickSessionBars filters a multi-day fallback lookback down to just the latest session", () => {
  const priorSession: RawAggBar[] = [{ t: JAN5_NOON_UTC, o: 100, h: 110, l: 90, c: 105 }];
  const latestSession: RawAggBar[] = [
    { t: JAN6_NOON_UTC, o: 106, h: 112, l: 104, c: 109 },
    { t: JAN6_NOON_UTC + 60_000, o: 109, h: 111, l: 107, c: 110 },
  ];
  const result = pickSessionBars([], [...priorSession, ...latestSession]);
  assert.deepEqual(result, toVectorBars(latestSession));
});

test("pickSessionBars returns an empty chart if the fallback's last bar has a malformed timestamp", () => {
  const fallbackBars: RawAggBar[] = [{ t: "corrupt", o: 100, h: 110, l: 90, c: 105 }];
  assert.deepEqual(pickSessionBars([], fallbackBars), []);
});
