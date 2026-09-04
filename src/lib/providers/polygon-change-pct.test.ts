import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { changePctFromSnapshotTicker, groundedBreadthSamples } from "./polygon";

test("changePctFromSnapshotTicker: uses provider field when present", () => {
  assert.equal(
    changePctFromSnapshotTicker({ todaysChangePerc: 1.234, ticker: "SPY" }),
    1.23
  );
});

test("changePctFromSnapshotTicker: rebases from prev close when provider omits change", () => {
  assert.equal(
    changePctFromSnapshotTicker({
      ticker: "NVDA",
      lastTrade: { p: 110 },
      prevDay: { c: 100 },
    }),
    10
  );
});

test("changePctFromSnapshotTicker: null when change cannot be grounded", () => {
  assert.equal(changePctFromSnapshotTicker({ ticker: "XYZ" }), null);
});

test("groundedBreadthSamples: drops null change rows", () => {
  assert.deepEqual(
    groundedBreadthSamples([
      { change_pct: 1.2 },
      { change_pct: null },
      { change_pct: -0.5 },
    ]),
    [{ change_pct: 1.2 }, { change_pct: -0.5 }]
  );
});

const src = readFileSync("src/lib/providers/polygon.ts", "utf8");

test("fetchMarketMovers: never defaults missing todaysChangePerc to 0", () => {
  assert.doesNotMatch(src, /todaysChangePerc \?\? 0/);
  assert.match(src, /changePctFromSnapshotTicker\(t\)/);
});

test("fetchStockSnapshotPerformance: never defaults missing change to 0", () => {
  assert.doesNotMatch(
    src,
    /snap\?\.todaysChangePerc \?\? 0/,
    "must not fabricate flat 0% for sector/leader snapshots"
  );
});
