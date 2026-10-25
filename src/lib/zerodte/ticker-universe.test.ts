import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ZERODTE_TICKER_UNIVERSE, resolveZeroDteTickerUniverse } from "./ticker-universe.ts";

test("DEFAULT_ZERODTE_TICKER_UNIVERSE: contains exactly Mag 7 + SPX/SPXW/SPY/QQQ, both Google classes", () => {
  const set = new Set(DEFAULT_ZERODTE_TICKER_UNIVERSE);
  for (const t of ["AAPL", "MSFT", "AMZN", "NVDA", "META", "TSLA", "GOOGL", "GOOG", "SPX", "SPXW", "SPY", "QQQ"]) {
    assert.ok(set.has(t), `expected ${t} in the default universe`);
  }
  assert.equal(set.size, 12, "no extra tickers beyond the named Mag 7 + index/ETF set");
});

test("resolveZeroDteTickerUniverse: no env override -> the default set", () => {
  const universe = resolveZeroDteTickerUniverse({});
  assert.ok(universe.has("NVDA"));
  assert.ok(universe.has("SPY"));
  assert.ok(!universe.has("TSM"), "a real but un-named ticker must not be eligible by default");
});

test("resolveZeroDteTickerUniverse: env override replaces the default, comma-separated, uppercased", () => {
  const universe = resolveZeroDteTickerUniverse({ ZERODTE_TICKER_UNIVERSE: "spy, qqq ,iwm" });
  assert.deepEqual([...universe].sort(), ["IWM", "QQQ", "SPY"]);
  assert.ok(!universe.has("NVDA"), "the override REPLACES the default, it does not add to it");
});

test("resolveZeroDteTickerUniverse: blank/whitespace-only env override falls back to the default", () => {
  const universe = resolveZeroDteTickerUniverse({ ZERODTE_TICKER_UNIVERSE: "   " });
  assert.ok(universe.has("AAPL"), "a blank override must not resolve to an empty (unrestricted) set");
});

test("resolveZeroDteTickerUniverse: returns a real Set (O(1) membership), not an array", () => {
  const universe = resolveZeroDteTickerUniverse({});
  assert.ok(universe instanceof Set);
});
