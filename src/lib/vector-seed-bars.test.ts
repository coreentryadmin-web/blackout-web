import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchVectorSeedBars } from "./vector-seed-bars";

test("fetchVectorSeedBars: uses today when bars exist", async () => {
  const bars = await fetchVectorSeedBars(new Date("2026-07-06T15:00:00Z"), async (_sym, from) => {
    if (from === "2026-07-06") {
      return [{ t: 1783368180000, o: 7500, h: 7510, l: 7490, c: 7505 }];
    }
    return [];
  });
  assert.equal(bars.sessionYmd, "2026-07-06");
  assert.equal(bars.bars.length, 1);
  assert.equal(bars.bars[0]?.close, 7505);
});

test("fetchVectorSeedBars: falls back to prior trading day when today is empty", async () => {
  const calls: string[] = [];
  const bars = await fetchVectorSeedBars(new Date("2026-07-07T05:00:00Z"), async (_sym, from) => {
    calls.push(from);
    if (from === "2026-07-06") {
      return [{ t: 1783368180000, o: 7530, h: 7540, l: 7520, c: 7537.43 }];
    }
    return [];
  });
  assert.deepEqual(calls, ["2026-07-07", "2026-07-06"]);
  assert.equal(bars.sessionYmd, "2026-07-06");
  assert.equal(bars.bars[0]?.close, 7537.43);
});
