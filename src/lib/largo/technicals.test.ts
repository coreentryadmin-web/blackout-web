import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

describe("buildLargoTechnicals live price paths", () => {
  const src = readFileSync(new URL("./technicals.ts", import.meta.url), "utf8");

  test("stock WS path carries authoritative changePct from getStockLiveCandle", () => {
    assert.match(src, /changePct = wsCandle\.changePct/);
    assert.match(src, /getStockLiveCandle\(stockSymbol\(ticker\)\)/);
  });

  test("index path resolves live indexStore via resolveLiveIndexWsEntry + overlay", () => {
    assert.match(src, /resolveLiveIndexWsEntry\(sym\)/);
    assert.match(src, /overlayRestIndexWithWs\(restSnap, wsEntry\)/);
    assert.doesNotMatch(
      src,
      /getStockLiveCandle\(wsTicker\)/,
      "indices must not read A.* stock candles for SPX/VIX day change"
    );
  });
});
