import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * SPX live-candle path is process-stateful (WS store + REST inflight map), so this
 * pins the contract in source: when getCurrentSpxCandle() has no bar, SPX must
 * fall through to the shared REST fallback instead of returning null immediately.
 * Regression for vector-e2e "candle null during RTH" at the 09:30 open window.
 */
test("getVectorLiveCandle: SPX falls back to REST when the WS store is empty", () => {
  const src = readFileSync(new URL("./vector-live-candle.ts", import.meta.url), "utf8");
  const spxBlock = src.slice(
    src.indexOf('if (t === "SPX")'),
    src.indexOf("const snap = getStockLiveCandle")
  );
  assert.match(spxBlock, /getCurrentSpxCandle\(\)/);
  assert.match(spxBlock, /if \(snap\.current\)/);
  assert.match(spxBlock, /return getRestFallbackCandle\(t\)/);
});
