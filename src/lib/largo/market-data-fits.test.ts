import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fitMarketOiChangeForModel,
  fitScreenerForModel,
  fitGroupGreekFlowForModel,
  fitGroupGreekFlowRowsForModel,
  fitEarningsRelatedNewsForModel,
} from "./market-data-fits";

const TRANSPORT_CAP = 16_384;

// Realistic per-entry sizes, MEASURED live 2026-08-29 against the real UW endpoints (see the
// findings-staging entry for this fix) — not guessed. Using fixtures this size is the whole point:
// the caps these functions ship with were tuned against numbers this small would never catch.
const oiEntry = (i: number) => ({
  ticker: `T${i}`,
  strike: 100 + i,
  expiry: "2026-09-19",
  oi_change: i * 137,
  volume: i * 900,
  premium: `${i * 1000}.00`,
  side: i % 2 ? "call" : "put",
  blob: "x".repeat(500), // pads each entry to ~635 bytes, matching the live measurement
});

const screenerEntry = (i: number) => ({
  ticker: `T${i}`,
  price: 100 + i,
  technicals: { rsi: 50, macd: 0.1, ema20: 99, ema50: 95, atr: 2.1, adx: 20, blob: "x".repeat(1700) }, // ~1956 bytes/entry live
});

const greekRow = (i: number) => ({
  timestamp: "2026-08-28T13:30:00Z",
  transactions: i,
  dir_delta_flow: `${i * 1000}.0000000000`,
  dir_vega_flow: `${i * 500}.0000000000`,
  total_delta_flow: `${i * 2000}.0000000000`,
  net_call_premium: `${i * 100}.00`,
  net_put_premium: `${i * 50}.00`,
  blob: "x".repeat(550), // ~708 bytes/entry, matching the live mag7 measurement (277KB / 391 rows)
});

test("fitMarketOiChangeForModel: 8-entry cap stays under the transport budget at MEASURED entry size", () => {
  const raw = Array.from({ length: 30 }, (_, i) => oiEntry(i));
  const { fitted } = fitMarketOiChangeForModel(raw);
  assert.equal(fitted.shown, 8);
  assert.equal(fitted.truncated, true);
  assert.equal(fitted.max_shown, 8);
  assert.ok(JSON.stringify(fitted).length < TRANSPORT_CAP, `fitted payload ${JSON.stringify(fitted).length} must be under ${TRANSPORT_CAP}`);
});

test("fitMarketOiChangeForModel: under-cap input passes through untruncated", () => {
  const raw = Array.from({ length: 5 }, (_, i) => oiEntry(i));
  const { fitted } = fitMarketOiChangeForModel(raw);
  assert.equal(fitted.shown, 5);
  assert.equal(fitted.truncated, false);
});

test("fitScreenerForModel: 3-entry cap stays under the transport budget at MEASURED entry size (~1956B, not the ~300-400B originally assumed)", () => {
  const raw = Array.from({ length: 25 }, (_, i) => screenerEntry(i));
  const { fitted } = fitScreenerForModel(raw);
  assert.equal(fitted.shown, 3);
  assert.equal(fitted.truncated, true);
  assert.ok(JSON.stringify(fitted).length < TRANSPORT_CAP, `fitted payload ${JSON.stringify(fitted).length} must be under ${TRANSPORT_CAP}`);
  // The regression this guards: the ORIGINAL 15-entry cap (#3155) at this real entry size is
  // ~29KB — nearly double the cap on its own. Prove the old cap really would have failed here,
  // so this test can't have quietly become vacuous if entry size assumptions drift again.
  const oldCapPayload = JSON.stringify({ candidates: raw.slice(0, 15), shown: 15, truncated: true, max_shown: 15 });
  assert.ok(oldCapPayload.length > TRANSPORT_CAP, "sanity: the old 15-entry cap must exceed the transport budget at this measured entry size");
});

test("fitGroupGreekFlowForModel: unchanged behavior (array-shaped input, e.g. a future per-group summary list)", () => {
  const raw = Array.from({ length: 20 }, (_, i) => ({ group: `g${i}`, net_delta: i }));
  const { fitted } = fitGroupGreekFlowForModel(raw);
  assert.equal(fitted.shown, 8);
  assert.equal(fitted.truncated, true);
});

test("fitGroupGreekFlowRowsForModel: 8-row cap stays under budget at MEASURED row size (mag7 default: 391 rows / ~277KB live)", () => {
  const raw = Array.from({ length: 391 }, (_, i) => greekRow(i));
  const fitted = fitGroupGreekFlowRowsForModel(raw);
  assert.equal(fitted.rows_shown, 8);
  assert.equal(fitted.rows_truncated, true);
  assert.equal(fitted.rows_max_shown, 8);
  assert.ok(JSON.stringify(fitted).length < TRANSPORT_CAP, `fitted payload ${JSON.stringify(fitted).length} must be under ${TRANSPORT_CAP}`);
});

test("fitGroupGreekFlowRowsForModel: empty/undefined input never throws and reports nothing shown", () => {
  assert.deepEqual(fitGroupGreekFlowRowsForModel([]), {
    rows: undefined,
    rows_shown: 0,
    rows_truncated: false,
    rows_max_shown: 8,
  });
  assert.deepEqual(fitGroupGreekFlowRowsForModel(undefined as unknown as Record<string, unknown>[]), {
    rows: undefined,
    rows_shown: 0,
    rows_truncated: false,
    rows_max_shown: 8,
  });
});

// A real Benzinga news article, shaped like fetchBenzingaNews's return (providers/polygon.ts):
// body up to 2000 chars, teaser up to 400 — MEASURED at that shape, not guessed.
const benzingaArticle = (i: number) => ({
  id: `art-${i}`,
  title: `Ticker ${i} earnings preview`,
  teaser: "x".repeat(400),
  body: "x".repeat(2000),
  published: "2026-08-29T12:00:00Z",
  tickers: ["NVDA"],
  channels: ["earnings"],
  tags: ["preview"],
  url: `https://example.com/article-${i}`,
  author: "staff",
});

test("fitEarningsRelatedNewsForModel: 5-article cap drops `body` and stays tiny even at 15 real-shaped articles", () => {
  const raw = Array.from({ length: 15 }, (_, i) => benzingaArticle(i));
  // Sanity: the OLD unbounded field (`related_news: related`) at this real shape blows the cap
  // more than 2x over on its own, before anything else in get_earnings's payload is counted.
  assert.ok(JSON.stringify(raw).length > TRANSPORT_CAP * 2, "sanity: 15 full articles must dwarf the transport cap");

  const fitted = fitEarningsRelatedNewsForModel(raw);
  assert.equal(fitted.related_news_shown, 5);
  assert.equal(fitted.related_news_truncated, true);
  assert.equal(fitted.related_news_max_shown, 5);
  assert.equal(fitted.related_news.length, 5);
  for (const item of fitted.related_news) {
    assert.equal("body" in item, false, "body must be dropped entirely, not just capped");
    assert.ok(item.teaser.length <= 200);
  }
  assert.ok(
    JSON.stringify(fitted).length < TRANSPORT_CAP,
    `fitted related_news alone ${JSON.stringify(fitted).length} must leave headroom for the rest of get_earnings's payload`
  );
});

test("fitEarningsRelatedNewsForModel: under-cap input passes through untruncated", () => {
  const raw = Array.from({ length: 2 }, (_, i) => benzingaArticle(i));
  const fitted = fitEarningsRelatedNewsForModel(raw);
  assert.equal(fitted.related_news_shown, 2);
  assert.equal(fitted.related_news_truncated, false);
});

test("fitEarningsRelatedNewsForModel: empty/undefined input never throws", () => {
  assert.deepEqual(fitEarningsRelatedNewsForModel([]).related_news, []);
  assert.deepEqual(fitEarningsRelatedNewsForModel(undefined as unknown as Record<string, unknown>[]).related_news, []);
});
