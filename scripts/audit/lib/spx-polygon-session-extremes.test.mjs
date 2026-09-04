import test from "node:test";
import assert from "node:assert/strict";
import { sessionExtremesFromMinuteBars } from "./spx-polygon-session-extremes.mjs";

test("sessionExtremesFromMinuteBars: max high and min low across bars", () => {
  const bars = [
    { h: 7740, l: 7730 },
    { h: 7750.19, l: 7733.93 },
    { h: 7742, l: 7735 },
  ];
  const { hod, lod } = sessionExtremesFromMinuteBars(bars);
  assert.equal(hod, 7750.19);
  assert.equal(lod, 7730);
});

test("sessionExtremesFromMinuteBars: empty input returns nulls", () => {
  assert.deepEqual(sessionExtremesFromMinuteBars([]), { hod: null, lod: null });
  assert.deepEqual(sessionExtremesFromMinuteBars(null), { hod: null, lod: null });
});

test("sessionExtremesFromMinuteBars: minute extremes can exceed a stale daily bar high", () => {
  const bars = [{ h: 7750.19, l: 7733.93 }];
  const dailyHigh = 7742.22;
  const { hod } = sessionExtremesFromMinuteBars(bars);
  assert.ok(hod > dailyHigh, "minute HOD must be allowed to beat lagging daily aggregate");
});
