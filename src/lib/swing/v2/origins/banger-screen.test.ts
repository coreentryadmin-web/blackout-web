import { test } from "node:test";
import assert from "node:assert/strict";
import { bangerTickersFromGroupedDaily } from "./banger-screen";

test("bangerTickersFromGroupedDaily: admits high-gain closed-strong names", () => {
  const tickers = bangerTickersFromGroupedDaily([
    { T: "ANET", o: 100, h: 120, l: 99, c: 118, v: 5_000_000 },
    { T: "FLAT", o: 50, h: 51, l: 49, c: 50.1, v: 5_000_000 },
  ]);
  assert.deepEqual(tickers, ["ANET"]);
});
