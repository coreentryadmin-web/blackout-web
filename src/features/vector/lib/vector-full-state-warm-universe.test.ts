import { test, mock, before } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

let sharedUniverse: string[] = [];
let openPositions: Array<{ ticker: string }> = [];
let fetchOpenSwingPositionsShouldThrow = false;

mock.module("./vector-dynamic-universe", {
  namedExports: {
    listSharedUniverseTickers: async () => sharedUniverse,
    mergeSharedUniverseTickers: (staticList: string[], dynamicList: string[]) => [
      ...new Set(
        [...staticList, ...dynamicList].map((t) => String(t).trim().toUpperCase()).filter(Boolean)
      ),
    ],
  },
});

mock.module("../../../lib/db", {
  namedExports: {
    fetchOpenSwingPositions: async () => {
      if (fetchOpenSwingPositionsShouldThrow) throw new Error("db unavailable");
      return openPositions;
    },
  },
});

let activeVectorFullStateTickers: typeof import("./vector-full-state-warm-universe").activeVectorFullStateTickers;

before(async () => {
  ({ activeVectorFullStateTickers } = await import("./vector-full-state-warm-universe"));
});

test("unions the shared static/dynamic universe with real open swing-position tickers", async () => {
  sharedUniverse = ["SPY", "SPX", "AAPL"];
  openPositions = [{ ticker: "HUT" }, { ticker: "MSTR" }];
  fetchOpenSwingPositionsShouldThrow = false;

  const out = await activeVectorFullStateTickers();

  assert.deepEqual(new Set(out), new Set(["SPY", "SPX", "AAPL", "HUT", "MSTR"]));
});

test("de-duplicates an open swing position already inside the shared universe", async () => {
  sharedUniverse = ["SPY", "AAPL"];
  openPositions = [{ ticker: "AAPL" }, { ticker: "HUT" }];
  fetchOpenSwingPositionsShouldThrow = false;

  const out = await activeVectorFullStateTickers();

  assert.equal(out.filter((t) => t === "AAPL").length, 1);
  assert.ok(out.includes("HUT"));
});

test("a DB failure degrades to the shared universe alone, never throws", async () => {
  sharedUniverse = ["SPY", "AAPL"];
  openPositions = [];
  fetchOpenSwingPositionsShouldThrow = true;

  const out = await activeVectorFullStateTickers();

  assert.deepEqual(new Set(out), new Set(["SPY", "AAPL"]));
});

test("no open positions leaves the shared universe untouched", async () => {
  sharedUniverse = ["SPY", "SPX"];
  openPositions = [];
  fetchOpenSwingPositionsShouldThrow = false;

  const out = await activeVectorFullStateTickers();

  assert.deepEqual(new Set(out), new Set(["SPY", "SPX"]));
});
