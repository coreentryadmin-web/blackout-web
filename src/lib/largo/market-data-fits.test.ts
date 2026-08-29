import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fitMarketOiChangeForModel,
  fitScreenerForModel,
  fitGroupGreekFlowForModel,
  fitGroupGreekFlowRowsForModel,
  fitEarningsRelatedNewsForModel,
  fitGroupGreekFlowToolResultForModel,
} from "./market-data-fits";

const TRANSPORT_CAP = 16_384;

// Realistic per-entry sizes, MEASURED live 2026-08-29 against the real UW endpoints (see the
// findings-staging entries for this fix) — not guessed.
const oiEntry = (i: number, blobChars = 500) => ({
  ticker: `T${i}`,
  strike: 100 + i,
  expiry: "2026-09-19",
  oi_change: i * 137,
  volume: i * 900,
  premium: `${i * 1000}.00`,
  side: i % 2 ? "call" : "put",
  blob: "x".repeat(blobChars), // ~500 chars pads each entry to ~635 bytes, matching the live measurement
});

const screenerEntry = (i: number, blobChars = 1700) => ({
  ticker: `T${i}`,
  price: 100 + i,
  technicals: { rsi: 50, macd: 0.1, ema20: 99, ema50: 95, atr: 2.1, adx: 20, blob: "x".repeat(blobChars) }, // ~1956 bytes/entry live
});

const greekRow = (i: number, blobChars = 550) => ({
  timestamp: "2026-08-28T13:30:00Z",
  transactions: i,
  dir_delta_flow: `${i * 1000}.0000000000`,
  dir_vega_flow: `${i * 500}.0000000000`,
  total_delta_flow: `${i * 2000}.0000000000`,
  net_call_premium: `${i * 100}.00`,
  net_put_premium: `${i * 50}.00`,
  blob: "x".repeat(blobChars), // ~708 bytes/entry, matching the live mag7 measurement (277KB / 391 rows)
});

// WHY THESE TESTS ARE SHAPED THIS WAY. Three rounds of fixed-row-count caps on these same three
// functions (15 → 8 → 3 for the screener, 20 → 15 → 8 for OI change, 15 → 8 for group-greek-flow
// rows) were each proven safe against a fixture sized at ONE point-in-time entry measurement, then
// truncated live in production anyway — twice each. The fix (fitRowsToBudget, a runtime byte
// measurement) can't be validated the same way a fixed count was: a fixture at exactly the
// measured size would pass whether or not the function actually adapts to a bigger one. So every
// test below runs the SAME fitter at both the measured size AND a deliberately much larger one
// (simulating exactly the kind of prod-vs-sandbox entry-size discrepancy that broke the fixed
// counts) and asserts it stays under budget at both — proving the self-correcting property is
// real, not just that today's measured size happens to fit.

test("fitMarketOiChangeForModel stays under the transport cap at measured size AND at a much larger one", () => {
  for (const blobChars of [500, 3000]) {
    const raw = Array.from({ length: 30 }, (_, i) => oiEntry(i, blobChars));
    const { fitted } = fitMarketOiChangeForModel(raw);
    assert.equal(fitted.truncated, true, `blobChars=${blobChars}`);
    assert.ok(fitted.shown > 0, `blobChars=${blobChars}: must keep at least one row`);
    assert.ok(
      JSON.stringify(fitted).length < TRANSPORT_CAP,
      `blobChars=${blobChars}: fitted payload ${JSON.stringify(fitted).length} must be under ${TRANSPORT_CAP}`
    );
  }
});

test("fitMarketOiChangeForModel: under-cap input passes through untruncated", () => {
  const raw = Array.from({ length: 5 }, (_, i) => oiEntry(i));
  const { fitted } = fitMarketOiChangeForModel(raw);
  assert.equal(fitted.shown, 5);
  assert.equal(fitted.truncated, false);
});

test("fitScreenerForModel stays under the transport cap at measured size AND at a much larger one", () => {
  for (const blobChars of [1700, 6000]) {
    const raw = Array.from({ length: 25 }, (_, i) => screenerEntry(i, blobChars));
    const { fitted } = fitScreenerForModel(raw);
    assert.equal(fitted.truncated, true, `blobChars=${blobChars}`);
    assert.ok(fitted.shown > 0, `blobChars=${blobChars}: must keep at least one row`);
    assert.ok(
      JSON.stringify(fitted).length < TRANSPORT_CAP,
      `blobChars=${blobChars}: fitted payload ${JSON.stringify(fitted).length} must be under ${TRANSPORT_CAP}`
    );
  }
});

test("fitGroupGreekFlowForModel: unchanged behavior (array-shaped input, e.g. a future per-group summary list)", () => {
  const raw = Array.from({ length: 20 }, (_, i) => ({ group: `g${i}`, net_delta: i, blob: "x".repeat(800) }));
  const { fitted } = fitGroupGreekFlowForModel(raw);
  assert.equal(fitted.truncated, true);
  assert.ok(JSON.stringify(fitted).length < TRANSPORT_CAP);
});

test("fitGroupGreekFlowRowsForModel stays under budget at measured size AND at a much larger one (mag7 default: 391 rows / ~277KB live)", () => {
  for (const blobChars of [550, 3000]) {
    const raw = Array.from({ length: 391 }, (_, i) => greekRow(i, blobChars));
    const fitted = fitGroupGreekFlowRowsForModel(raw);
    assert.equal(fitted.rows_truncated, true, `blobChars=${blobChars}`);
    assert.ok((fitted.rows_shown ?? 0) > 0, `blobChars=${blobChars}: must keep at least one row`);
    assert.ok(
      JSON.stringify(fitted).length < TRANSPORT_CAP,
      `blobChars=${blobChars}: fitted payload ${JSON.stringify(fitted).length} must be under ${TRANSPORT_CAP}`
    );
  }
});

test("fitGroupGreekFlowRowsForModel: empty/undefined input never throws and reports nothing shown", () => {
  assert.deepEqual(fitGroupGreekFlowRowsForModel([]), {
    rows: undefined,
    rows_shown: 0,
    rows_truncated: false,
    rows_max_shown: 15,
  });
  assert.deepEqual(fitGroupGreekFlowRowsForModel(undefined as unknown as Record<string, unknown>[]), {
    rows: undefined,
    rows_shown: 0,
    rows_truncated: false,
    rows_max_shown: 15,
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

test("fitGroupGreekFlowToolResultForModel budgets the full tool envelope (rows + summary + note)", () => {
  const summary = {
    group: "mag7",
    net_delta: 1_200_000,
    net_gamma: 500,
    call_delta: 800_000,
    put_delta: 400_000,
    bias: "supportive" as const,
    headline: "Mag7 dealer gamma supportive — net 1.20M delta",
    row_count: 391,
  };
  const raw = Array.from({ length: 391 }, (_, i) => greekRow(i));
  const fitted = fitGroupGreekFlowToolResultForModel({
    group: "mag7",
    source: "unusual_whales",
    note: "Unusual Whales exclusive — not available on free tiers.",
    summary,
    rows: raw,
  });
  assert.equal(fitted.rows_truncated, true);
  assert.ok((fitted.rows_shown ?? 0) > 0);
  assert.ok(JSON.stringify(fitted).length < TRANSPORT_CAP);
});

test("fitEarningsRelatedNewsForModel: drops `body` and stays tiny even at 15 real-shaped articles", () => {
  const raw = Array.from({ length: 15 }, (_, i) => benzingaArticle(i));
  // Sanity: the OLD unbounded field (`related_news: related`) at this real shape blows the cap
  // more than 2x over on its own, before anything else in get_earnings's payload is counted.
  assert.ok(JSON.stringify(raw).length > TRANSPORT_CAP * 2, "sanity: 15 full articles must dwarf the transport cap");

  const fitted = fitEarningsRelatedNewsForModel(raw);
  assert.equal(fitted.related_news_truncated, true, "15 raw articles capped to 5 by maxRows");
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
