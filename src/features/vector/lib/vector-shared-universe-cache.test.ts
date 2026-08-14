import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

const mod = () => import("./vector-shared-universe-cache");

test("isSharedUniverseTickerSync: static seed + dynamic refresh", async () => {
  const {
    isSharedUniverseTickerSync,
    _setSharedUniverseForTest,
    _resetSharedUniverseCacheForTest,
  } = await mod();
  _resetSharedUniverseCacheForTest();
  assert.equal(isSharedUniverseTickerSync("NVDA"), true);
  assert.equal(isSharedUniverseTickerSync("ZZZZ"), false);

  _setSharedUniverseForTest(["NVDA", "DYN1"]);
  assert.equal(isSharedUniverseTickerSync("DYN1"), true);
  assert.equal(isSharedUniverseTickerSync("META"), false);

  _resetSharedUniverseCacheForTest();
});
