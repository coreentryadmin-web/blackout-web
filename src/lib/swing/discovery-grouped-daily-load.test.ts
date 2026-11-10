import assert from "node:assert/strict";
import test from "node:test";

import { createMemoizedGroupedDailyLoader } from "./discovery-grouped-daily-load";

test("createMemoizedGroupedDailyLoader: one upstream call serves multiple consumers", async () => {
  let calls = 0;
  const fetchSummary = async (ymd: string) => {
    calls += 1;
    return { results: [{ T: "SPY", c: 1, o: 1, h: 1, l: 1, v: 1, t: Date.parse(`${ymd}T20:00:00Z`) }] };
  };
  const load = createMemoizedGroupedDailyLoader(fetchSummary, "2026-11-09");
  const [a, b] = await Promise.all([load(), load()]);
  assert.equal(calls, 1);
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
});

test("createMemoizedGroupedDailyLoader: retries transient 429 before surfacing failure", async () => {
  let calls = 0;
  const fetchSummary = async () => {
    calls += 1;
    if (calls < 3) throw new Error("Polygon → 429 (rate limited)");
    return { results: [] };
  };
  const load = createMemoizedGroupedDailyLoader(fetchSummary, "2026-11-09", {
    maxAttempts: 4,
    baseDelayMs: 1,
  });
  const rows = await load();
  assert.equal(calls, 3);
  assert.deepEqual(rows, []);
});
