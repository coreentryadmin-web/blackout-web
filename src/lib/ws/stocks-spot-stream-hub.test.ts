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
import {
  recordStockTick,
  _resetStockCandleStoreForTest,
  _setSnapshotFetcherForTest,
  _skewLocalUpdatedAtForTest,
} from "./stock-candle-store";

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

test("buildSpotFrame: omits changePct until REST anchor is authoritative", () => {
  _resetStockCandleStoreForTest();
  const atMs = Date.parse("2026-07-15T14:31:00.000Z");
  recordStockTick("NVDA", 140, undefined, atMs);
  recordStockTick("NVDA", 147, undefined, atMs + 5_000);

  const frame = buildSpotFrame(["NVDA"]);
  assert.equal(frame.quotes.NVDA.price, 147);
  assert.equal(frame.quotes.NVDA.changePct, null);
});

// Regression: /api/market/quote (route.ts) requires a WS tick to be <10s old before
// trusting it as "live" (falls back to REST otherwise, via its own WS_STALE_MS gate) —
// but this hub's buildSpotFrame had NO such ceiling, only the much looser 60s
// MAX_CANDLE_AGE_MS enforced deep inside getStockLiveCandle(). For a lightly-traded
// ticker whose WS ticks are naturally sparse, a tick 10-60s old would be pushed over
// SSE as "live" with no REST fallback at all, and the client (useLiveQuoteStream,
// GexHeatmap.tsx's stockPushLive) unconditionally prioritizes it over the fresher REST
// quote with no staleness check of its own — so a stale price could override a correct
// one and display as live for up to a minute. This also contradicts buildSpotFrame's own
// doc comment ("a ticker with no live candle yet ... is simply omitted"): the omission
// was supposed to cover "stale", not just "literally absent".
test("buildSpotFrame: omits a ticker whose WS tick is stale beyond the quote route's own freshness bar", () => {
  _resetStockCandleStoreForTest();
  recordStockTick("ILLQ", 42, undefined, Date.now());
  assert.ok(buildSpotFrame(["ILLQ"]).quotes.ILLQ, "sanity: present while genuinely fresh");

  // 15s stale — past the quote route's 10s WS staleness bar, but still well inside the
  // candle store's own looser 60s MAX_CANDLE_AGE_MS, so getStockLiveCandle() alone would
  // still happily return a non-null `current` for it.
  _skewLocalUpdatedAtForTest("ILLQ", -15_000);

  const frame = buildSpotFrame(["ILLQ"]);
  assert.equal(frame.quotes.ILLQ, undefined, "a >10s-stale WS tick must not be pushed as live");
});

test("encodeSpotFrame: produces a well-formed SSE data line", () => {
  const encoded = encodeSpotFrame({ type: "quotes", quotes: { AAPL: { price: 230, changePct: 1.2, asof: "x" } }, ts: 1 });
  assert.ok(encoded.startsWith("data: "));
  assert.ok(encoded.endsWith("\n\n"));
  const parsed = JSON.parse(encoded.slice("data: ".length).trim());
  assert.equal(parsed.quotes.AAPL.price, 230);
});

test("encodeSpotFrame: rounds IEEE float noise on price and changePct at the wire boundary", () => {
  const encoded = encodeSpotFrame({
    type: "quotes",
    quotes: {
      NVDA: {
        price: 147.180000000001,
        changePct: 1.23456789,
        asof: "2026-07-15T14:31:00.000Z",
      },
    },
    ts: 1_750_000_000_123,
  });
  const parsed = JSON.parse(encoded.slice("data: ".length).trim());
  assert.equal(parsed.quotes.NVDA.price, 147.18);
  assert.equal(parsed.quotes.NVDA.changePct, 1.23);
  assert.equal(parsed.ts, 1_750_000_000_123);
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
