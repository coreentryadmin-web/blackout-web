import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSessionBarFromMinuteBars,
  mergeMinuteRefreshedBars,
} from "./breakout-intraday-breadth";

test("buildSessionBarFromMinuteBars aggregates OHLCV", () => {
  const bar = buildSessionBarFromMinuteBars("nvda", [
    { t: 1000, o: 100, h: 101, l: 99, c: 100.5, v: 1000 },
    { t: 1060, o: 100.5, h: 103, l: 100, c: 102, v: 2000 },
  ]);
  assert.ok(bar);
  assert.equal(bar!.T, "NVDA");
  assert.equal(bar!.o, 100);
  assert.equal(bar!.h, 103);
  assert.equal(bar!.l, 99);
  assert.equal(bar!.c, 102);
  assert.equal(bar!.v, 3000);
});

test("mergeMinuteRefreshedBars overrides grouped rows by ticker", () => {
  const base = [{ T: "AAPL", o: 1, h: 2, l: 1, c: 1.5, v: 100, t: 1 }];
  const refreshed = new Map([
    ["AAPL", { T: "AAPL", o: 1, h: 3, l: 1, c: 2.5, v: 500, t: 999 }],
  ]);
  const merged = mergeMinuteRefreshedBars(base, refreshed);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.c, 2.5);
});
