import { test } from "node:test";
import assert from "node:assert/strict";
import { _resetSpyVolumeCacheForTest, spyVolumeForMinuteBar } from "./vector-spy-volume";

test("spyVolumeForMinuteBar: returns SPY volume for matching minute bucket", async () => {
  _resetSpyVolumeCacheForTest();
  const barTime = 1_750_000_000;
  const vol = await spyVolumeForMinuteBar(
    barTime,
    1_750_000_500_000,
    async () => [{ t: barTime * 1000, o: 1, h: 1, l: 1, c: 1, v: 1_234_567 }]
  );
  assert.equal(vol, 1_234_567);
});

test("spyVolumeForMinuteBar: caches within the same minute bar", async () => {
  _resetSpyVolumeCacheForTest();
  let calls = 0;
  const fetchSpy = async () => {
    calls++;
    return [{ t: 1_750_000_000_000, o: 1, h: 1, l: 1, c: 1, v: 99 }];
  };
  const t = 1_750_000_000;
  assert.equal(await spyVolumeForMinuteBar(t, 1_750_000_010_000, fetchSpy), 99);
  assert.equal(await spyVolumeForMinuteBar(t, 1_750_000_020_000, fetchSpy), 99);
  assert.equal(calls, 1);
});
