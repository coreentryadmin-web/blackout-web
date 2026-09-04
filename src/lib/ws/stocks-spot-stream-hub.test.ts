import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTickerList,
  buildSpotFrame,
  encodeSpotFrame,
  tryAcquireSpotStreamConnection,
  releaseSpotStreamConnection,
  spotStreamConnectionCount,
  _resetSpotStreamHubForTest,
  MAX_TICKERS_PER_STREAM,
} from "./stocks-spot-stream-hub";
import { recordStockTick, _resetStockCandleStoreForTest, _setSnapshotFetcherForTest } from "./stock-candle-store";

// Network-free, same reasoning as stock-candle-store.test.ts.
_setSnapshotFetcherForTest(async () => null);

test("parseTickerList: parses, uppercases, and dedupes a comma list", () => {
  const { tickers, error } = parseTickerList("aapl,MSFT,aapl, tsla ");
  assert.equal(error, undefined);
  assert.deepEqual(tickers, ["AAPL", "MSFT", "TSLA"]);
});

test("parseTickerList: rejects missing/empty input", () => {
  assert.equal(parseTickerList(null).error, "Missing tickers");
  assert.equal(parseTickerList("").error, "Missing tickers");
  assert.equal(parseTickerList("   ").error, "Missing tickers");
});

test("parseTickerList: rejects a syntactically invalid ticker", () => {
  const { error } = parseTickerList("AAPL,not$valid");
  assert.match(error ?? "", /Invalid ticker/);
});

test("parseTickerList: enforces the max-tickers cap", () => {
  const many = Array.from({ length: 5 }, (_, i) => `T${i}`).join(",");
  const { error } = parseTickerList(many, 3);
  assert.match(error ?? "", /Too many tickers/);
});

test("parseTickerList: default cap matches MAX_TICKERS_PER_STREAM", () => {
  const many = Array.from({ length: MAX_TICKERS_PER_STREAM + 1 }, (_, i) => `T${i}`).join(",");
  assert.match(parseTickerList(many).error ?? "", /Too many tickers/);
});

test("buildSpotFrame: includes only tickers with a live candle, omits the rest", () => {
  _resetStockCandleStoreForTest();
  const atMs = Date.parse("2026-07-15T14:30:00.000Z");
  recordStockTick("AAPL", 230, undefined, atMs);

  const frame = buildSpotFrame(["AAPL", "ZZZZ"], atMs + 500);
  assert.equal(frame.type, "quotes");
  assert.ok(frame.quotes.AAPL);
  assert.equal(frame.quotes.AAPL.price, 230);
  assert.equal(frame.quotes.ZZZZ, undefined);
  assert.equal(frame.ts, atMs + 500);
});

test("buildSpotFrame: carries changePct through from the store", () => {
  _resetStockCandleStoreForTest();
  const atMs = Date.parse("2026-07-15T14:31:00.000Z");
  recordStockTick("NVDA", 140, undefined, atMs);
  recordStockTick("NVDA", 147, undefined, atMs + 5_000);

  const frame = buildSpotFrame(["NVDA"]);
  // No REST anchor (stubbed null) — ws-bar fallback anchors off the first tick's open (140).
  assert.equal(frame.quotes.NVDA.changePct, Number((((147 - 140) / 140) * 100).toFixed(2)));
});

test("buildSpotFrame: rounds IEEE float tails on price and changePct", () => {
  _resetStockCandleStoreForTest();
  const atMs = Date.parse("2026-07-15T14:30:00.000Z");
  recordStockTick("AAPL", 230.123456789, undefined, atMs);

  const frame = buildSpotFrame(["AAPL"], atMs);
  assert.equal(frame.quotes.AAPL.price, 230.12);
});

test("encodeSpotFrame: produces a well-formed SSE data line", () => {
  const encoded = encodeSpotFrame({ type: "quotes", quotes: { AAPL: { price: 230, changePct: 1.2, asof: "x" } }, ts: 1 });
  assert.ok(encoded.startsWith("data: "));
  assert.ok(encoded.endsWith("\n\n"));
  const parsed = JSON.parse(encoded.slice("data: ".length).trim());
  assert.equal(parsed.quotes.AAPL.price, 230);
});

test("connection cap: acquires up to the limit then rejects", () => {
  _resetSpotStreamHubForTest();
  assert.equal(tryAcquireSpotStreamConnection(2), true);
  assert.equal(tryAcquireSpotStreamConnection(2), true);
  assert.equal(tryAcquireSpotStreamConnection(2), false);
  assert.equal(spotStreamConnectionCount(), 2);
});

test("connection cap: release frees a slot for a subsequent acquire", () => {
  _resetSpotStreamHubForTest();
  tryAcquireSpotStreamConnection(1);
  assert.equal(tryAcquireSpotStreamConnection(1), false);
  releaseSpotStreamConnection();
  assert.equal(tryAcquireSpotStreamConnection(1), true);
});

test("connection cap: release never goes negative", () => {
  _resetSpotStreamHubForTest();
  releaseSpotStreamConnection();
  releaseSpotStreamConnection();
  assert.equal(spotStreamConnectionCount(), 0);
});
