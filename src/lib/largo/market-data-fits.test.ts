import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fitMarketOiChangeForModel,
  fitScreenerForModel,
  fitGroupGreekFlowForModel,
  fitGroupGreekFlowRowsForModel,
  fitEarningsRelatedNewsForModel,
  fitEarningsUwHistoryForModel,
  fitEarningsEstimatesForModel,
  fitGroupGreekFlowToolResultForModel,
  fitGexLadderForModel,
  fitOptionsFlowForModel,
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

// Realistic per-row shape, MEASURED live 2026-10-17 against the real UW endpoint
// (GET /api/earnings/<ticker>): NVDA returned 107 rows averaging 660 bytes/row (~70.6KB total),
// AAPL ~80.9KB, TSLA ~47.5KB — several times the entire 16k transport cap on this ONE field alone.
const uwEarningsRow = (i: number) => ({
  source: i === 0 ? "estimation" : "reported",
  report_time: i % 2 ? "premarket" : "postmarket",
  expected_move_perc: i === 0 ? null : "0.05330873875951118285",
  report_date: `2026-${String((i % 12) + 1).padStart(2, "0")}-15`,
  ending_fiscal_quarter: `2026-${String((i % 12) + 1).padStart(2, "0")}-31`,
  expected_move: i === 0 ? null : 11.56 + i,
  street_mean_est: `${(2 + i * 0.01).toFixed(4)}`,
  post_earnings_move_1d: i === 0 ? null : "-0.0915",
  actual_eps: i === 0 ? null : `${(2 + i * 0.01).toFixed(2)}`,
  post_earnings_move_1w: i === 0 ? null : "-0.04864187586700675706",
  post_earnings_move_2w: i === 0 ? null : "-0.03",
  post_earnings_move_3d: i === 0 ? null : "-0.02",
  pre_earnings_move_1d: i === 0 ? null : "0.01",
  pre_earnings_move_1w: i === 0 ? null : "0.02",
  pre_earnings_move_2w: i === 0 ? null : "0.03",
  pre_earnings_move_3d: i === 0 ? null : "0.015",
  short_straddle_1w: i === 0 ? null : "0.12",
  short_straddle_1d: i === 0 ? null : "0.05",
  long_straddle_1w: i === 0 ? null : "0.13",
  long_straddle_1d: i === 0 ? null : "0.06",
});

// Realistic single-row shape, MEASURED live 2026-10-17 against the real UW endpoint
// (GET /api/companies/<ticker>/earnings-estimates): extractRows cannot unwrap UW's
// `{ ticker, estimates:[...] }` response (the "estimates" key isn't in its recognized-wrapper
// list), so the whole response comes back as ONE opaque row — measured ~16KB regardless of ticker
// (NVDA 15.96KB, AAPL 16.07KB, TSLA 16.01KB, META 16.05KB, GOOG 16.12KB).
const uwEstimatesSingleRow = (approxBytes = 16_000) => ({
  ticker: "NVDA",
  estimates: Array.from({ length: Math.ceil(approxBytes / 260) }, (_, i) => ({
    date: `202${7 + (i % 3)}-0${(i % 9) + 1}-28`,
    horizon: i % 2 ? "fiscal quarter" : "fiscal year",
    revenue_estimate_low: 100_000_000_000 + i,
    revenue_estimate_high: 200_000_000_000 + i,
    revenue_estimate_average: 150_000_000_000 + i,
    revenue_estimate_analyst_count: 40 + i,
    eps_estimate_low: 2 + i * 0.01,
    eps_estimate_high: 3 + i * 0.01,
    eps_estimate_average: 2.5 + i * 0.01,
    eps_estimate_analyst_count: 40 + i,
    eps_estimate_revision_down_last_week: null,
    eps_estimate_revision_up_last_week: null,
  })),
});

test("get_earnings OLD unconditional merge shape blows the transport cap — the bug this fix closes", () => {
  // Reproduces run-tool.ts's PRE-FIX get_earnings merge: unusual_whales/estimates spread straight
  // in with no fitting at all. This is not a call into any function this repo ships today — it is
  // the literal shape the live bug had (CloudWatch measured TRUNCATED at 83506/16000 and
  // 90305/16000 chars), kept here so the fix's necessity stays provable after it ships.
  const base = {
    ticker: "NVDA",
    source: "benzinga_structured",
    next_report: { report_date: "2026-11-18" },
    print_history: [],
    print_history_summary: null,
    calendar_error: null,
    related_news: [],
    related_news_shown: 0,
    related_news_truncated: false,
    related_news_max_shown: 5,
  };
  const oldShape = {
    ...base,
    unusual_whales: Array.from({ length: 107 }, (_, i) => uwEarningsRow(i)),
    estimates: [uwEstimatesSingleRow()],
  };
  assert.ok(
    JSON.stringify(oldShape).length > TRANSPORT_CAP,
    `sanity: the old unconditional merge (${JSON.stringify(oldShape).length} chars) must exceed the transport cap to prove the bug`
  );
});

test("fitEarningsUwHistoryForModel stays under the transport cap at the measured real size (107 rows) AND a larger one, honoring an already-populated base", () => {
  for (const rowCount of [107, 400]) {
    const base = {
      ticker: "NVDA",
      source: "benzinga_structured",
      print_history: Array.from({ length: 6 }, (_, i) => ({ x: i })),
    };
    const rows = Array.from({ length: rowCount }, (_, i) => uwEarningsRow(i));
    const fitted = fitEarningsUwHistoryForModel(base, rows);
    assert.ok(
      JSON.stringify({ ...base, ...fitted }).length < TRANSPORT_CAP,
      `${rowCount}-row case must stay under the transport cap`
    );
    assert.equal(fitted.unusual_whales_truncated, rowCount > fitted.unusual_whales_shown);
  }
});

test("fitEarningsEstimatesForModel drops the whole estimates blob when the base has already consumed the budget", () => {
  const bigBase = {
    unusual_whales: Array.from({ length: 8 }, (_, i) => uwEarningsRow(i)),
    padding: "x".repeat(13_500), // pushes bigBase itself past LARGO_RESULT_CHAR_BUDGET alone
  };
  const fitted = fitEarningsEstimatesForModel(bigBase, [uwEstimatesSingleRow()]);
  assert.equal(fitted.estimates.length, 0);
  assert.equal(fitted.estimates_truncated, true);
});

test("fitEarningsEstimatesForModel keeps the estimates blob when there is room", () => {
  const smallBase = { ticker: "NVDA" };
  const fitted = fitEarningsEstimatesForModel(smallBase, [uwEstimatesSingleRow(1000)]);
  assert.equal(fitted.estimates.length, 1);
  assert.equal(fitted.estimates_truncated, false);
});

test("get_earnings full sequential fit (base -> related_news -> unusual_whales -> estimates) stays under the transport cap at full measured real-world size", () => {
  const earningsBase = {
    ticker: "NVDA",
    source: "benzinga_structured",
    next_report: { report_date: "2026-11-18", confirmed: true },
    print_history: Array.from({ length: 6 }, (_, i) => ({
      report_date: `2026-0${i + 1}-15`,
      eps: 1.2,
      revenue: 1_000_000,
      beat: true,
      session_change_pct: 2.3,
      next_day_change_pct: 1.1,
      reaction_basis: "report_session",
      reaction_pct: 2.3,
    })),
    print_history_summary: "6/6 EPS beats over last 6 prints · 83% rev beats of 6 · avg reaction +2.3%",
    calendar_error: null,
  };
  const relatedRaw = Array.from({ length: 15 }, (_, i) => ({
    title: `Analyst note ${i}`,
    teaser: "x".repeat(300),
    published: "2026-10-01",
    url: "https://example.com",
    body: "x".repeat(2000),
  }));
  const fittedRelatedNews = fitEarningsRelatedNewsForModel(relatedRaw, 5, earningsBase);
  const baseWithNews = { ...earningsBase, ...fittedRelatedNews };
  const uwRows = Array.from({ length: 107 }, (_, i) => uwEarningsRow(i));
  const fittedUw = fitEarningsUwHistoryForModel(baseWithNews, uwRows);
  const baseWithUw = { ...baseWithNews, ...fittedUw };
  const fittedEstimates = fitEarningsEstimatesForModel(baseWithUw, [uwEstimatesSingleRow()]);
  const final = { ...baseWithUw, ...fittedEstimates };
  assert.ok(
    JSON.stringify(final).length < TRANSPORT_CAP,
    `final get_earnings envelope (${JSON.stringify(final).length} chars) must stay under the transport cap`
  );
});

// Real live shape (SPX 0DTE, 2026-08-31, captured via vector-rth-quick-check.mjs / a direct
// GET /api/market/vector/gex-ladder?ticker=SPX&dte=0dte fetch): 200 rows, 5-point strikes,
// spot 7673.58, kings at 7700 (call) and 7650 (put), 18,858 raw chars — 118% of the 16k cap.
function liveShapedGexLadderFixture() {
  const spot = 7673.58;
  const callKingStrike = 7700;
  const putKingStrike = 7650;
  const rows: Array<Record<string, unknown>> = [];
  // 200 strikes, 5pt apart, spanning both sides of spot — same density as the live payload.
  for (let i = 0; i < 200; i++) {
    const strike = 8170 - i * 5;
    const isCall = strike >= spot;
    rows.push({
      strike,
      gex: isCall ? 10_000 + i * 137 : -(10_000 + i * 137),
      side: isCall ? "call" : "put",
      magnitude: 0.1,
      isKing: strike === callKingStrike || strike === putKingStrike,
      migration: null,
    });
  }
  return {
    ticker: "SPX",
    spot,
    asOf: "2026-08-31T13:47:36.473Z",
    horizon: "0dte",
    ladder: { spot, rows, maxAbs: 5_623_801_588.88 },
    depth: null,
    depthSpot: null,
  };
}

test("fitGexLadderForModel: live-shaped 200-row SPX ladder truncates raw but the fitted result stays under the transport cap", () => {
  const raw = liveShapedGexLadderFixture();
  const rawChars = JSON.stringify(raw).length;
  // Sanity: the fixture must actually reproduce the live overflow, else this test proves nothing.
  assert.ok(rawChars > TRANSPORT_CAP, `sanity: fixture (${rawChars} chars) must exceed the transport cap`);

  const fitted = fitGexLadderForModel(raw);
  const fittedChars = JSON.stringify(fitted).length;
  assert.ok(fittedChars < TRANSPORT_CAP, `fitted payload ${fittedChars} must be under ${TRANSPORT_CAP}`);
  assert.equal(fitted.rows_truncated, true);
  assert.ok(fitted.rows_shown > 0 && fitted.rows_shown < 200);
  assert.equal(fitted.rows_total, 200);
});

test("fitGexLadderForModel: never drops maxAbs, spot, or depth fields even when rows are cut", () => {
  const raw = liveShapedGexLadderFixture();
  const fitted = fitGexLadderForModel(raw);
  // These sit AFTER `rows` in the route's own key order, so a raw transport tail-cut drops them —
  // the fitter must keep them regardless of how many rows survive.
  assert.equal(fitted.ladder.maxAbs, raw.ladder.maxAbs);
  assert.equal(fitted.spot, raw.spot);
  assert.equal(fitted.asOf, raw.asOf);
  assert.equal(fitted.depthSpot, raw.depthSpot);
});

test("fitGexLadderForModel: both per-side kings always survive the cut, however small the budget forces the row count", () => {
  const raw = liveShapedGexLadderFixture();
  const fitted = fitGexLadderForModel(raw);
  const keptKings = fitted.ladder.rows.filter((r) => r.isKing);
  assert.equal(keptKings.length, 2, "the call king and the put king must both survive — they are the load-bearing rows");
});

test("fitGexLadderForModel: kept rows stay nearest-to-spot, not an arbitrary head slice of the descending-strike array", () => {
  const raw = liveShapedGexLadderFixture();
  const fitted = fitGexLadderForModel(raw);
  const keptStrikes = fitted.ladder.rows.map((r) => Number(r.strike));
  // The full fixture's array order is strictly descending from 8170 — a naive head-first cut would
  // keep only strikes near 8170 and never reach spot (7673.58) at all.
  const nearSpot = keptStrikes.some((s) => Math.abs(s - raw.spot) < 50);
  assert.ok(nearSpot, `kept strikes (${keptStrikes.slice(0, 10)}...) must include rows near spot, not just the array head`);
});

test("fitGexLadderForModel: kept rows are re-sorted back to descending-strike display order", () => {
  const raw = liveShapedGexLadderFixture();
  const fitted = fitGexLadderForModel(raw);
  const strikes = fitted.ladder.rows.map((r) => Number(r.strike));
  for (let i = 1; i < strikes.length; i++) {
    assert.ok(strikes[i - 1]! > strikes[i]!, "rows must be strictly descending by strike, same as the route's own output");
  }
});

test("fitGexLadderForModel: under-cap input passes through untruncated", () => {
  const raw = liveShapedGexLadderFixture();
  raw.ladder.rows = raw.ladder.rows.slice(0, 5);
  const fitted = fitGexLadderForModel(raw);
  assert.equal(fitted.rows_shown, 5);
  assert.equal(fitted.rows_truncated, false);
  assert.equal(fitted.ladder.rows.length, 5);
});

// Raw UW flow-alert/flow-recent row shape (unusual-whales.ts's parseUwFlowAlert input) —
// MEASURED TRUNCATED live 2026-10-17: get_options_flow served 33210/16000 chars for a single
// ticker's flow_alerts (up to 50 rows) + flow_recent (up to 100 rows) combined.
const uwFlowRow = (i: number, blobChars = 300) => ({
  ticker: "T",
  strike: 100 + i,
  strike_price: 100 + i,
  option_type: i % 2 ? "call" : "put",
  expiry: "2026-11-20",
  premium: i * 1500,
  total_premium: i * 1500,
  price: 1.5 + i * 0.01,
  size: 10 + i,
  volume: 100 + i * 10,
  open_interest: 500 + i,
  alerted_at: `2026-10-17T${String(9 + (i % 7)).padStart(2, "0")}:00:00Z`,
  alert_rule: i % 3 === 0 ? "RepeatedHits" : "VolumeOI",
  ask_pct: 0.6,
  trade_count: 1 + (i % 4),
  underlying_price: 450.12,
  blob: "x".repeat(blobChars), // pads toward a realistic raw-row size
});

const optionsFlowBase = (flowAlerts: Record<string, unknown>[], flowRecent: Record<string, unknown>[]) => ({
  ticker: "TSLA",
  source: "unusual_whales",
  note: "Unusual Whales exclusive — not available on free tiers.",
  window_hours: 48,
  helix_session_alerts: 12,
  intraday_0dte: { call_premium: 1_200_000, put_premium: 800_000, net: 400_000 },
  alert_premium: { calls: 1_200_000, puts: 800_000, net: 400_000 },
  bias: "bullish" as const,
  strike_stacks: Array.from({ length: 24 }, (_, i) => ({ strike: 100 + i, kind: "accumulation" })),
  flow_alerts: flowAlerts,
  flow_recent: flowRecent,
});

test("fitOptionsFlowForModel stays under the transport cap at measured size (50+100 rows) AND at a much larger per-row size", () => {
  for (const blobChars of [300, 1500]) {
    const flowAlerts = Array.from({ length: 50 }, (_, i) => uwFlowRow(i, blobChars));
    const flowRecent = Array.from({ length: 100 }, (_, i) => uwFlowRow(i, blobChars));
    const raw = optionsFlowBase(flowAlerts, flowRecent);
    const rawChars = JSON.stringify(raw).length;
    assert.ok(rawChars > TRANSPORT_CAP, `sanity: fixture (${rawChars} chars) must exceed the transport cap`);

    const fitted = fitOptionsFlowForModel(raw);
    const fittedChars = JSON.stringify(fitted).length;
    assert.ok(
      fittedChars < TRANSPORT_CAP,
      `blobChars=${blobChars}: fitted payload ${fittedChars} must be under ${TRANSPORT_CAP}`
    );
    // At least one of the two arrays must be reported truncated — a payload this big cannot
    // honestly fit both 50 and 100 full rows under the cap.
    assert.ok(
      fitted.flow_alerts_truncated || fitted.flow_recent_truncated,
      `blobChars=${blobChars}: at least one row field must be truncated`
    );
    // The aggregates that ARE this tool's actual answer must never be dropped, regardless of
    // how the row budget shakes out.
    assert.deepEqual(fitted.alert_premium, raw.alert_premium);
    assert.equal(fitted.bias, raw.bias);
    assert.deepEqual(fitted.strike_stacks, raw.strike_stacks);
  }
});

test("fitOptionsFlowForModel: under-cap input (few rows) passes through untruncated", () => {
  const flowAlerts = Array.from({ length: 3 }, (_, i) => uwFlowRow(i));
  const flowRecent = Array.from({ length: 3 }, (_, i) => uwFlowRow(i));
  const raw = optionsFlowBase(flowAlerts, flowRecent);
  const fitted = fitOptionsFlowForModel(raw);
  assert.equal(fitted.flow_alerts_shown, 3);
  assert.equal(fitted.flow_alerts_truncated, false);
  assert.equal(fitted.flow_recent_shown, 3);
  assert.equal(fitted.flow_recent_truncated, false);
});

test("fitOptionsFlowForModel: empty flow arrays never throw and report nothing shown", () => {
  const raw = optionsFlowBase([], []);
  const fitted = fitOptionsFlowForModel(raw);
  assert.equal(fitted.flow_alerts, undefined);
  assert.equal(fitted.flow_alerts_shown, 0);
  assert.equal(fitted.flow_alerts_truncated, false);
  assert.equal(fitted.flow_recent, undefined);
  assert.equal(fitted.flow_recent_shown, 0);
  assert.equal(fitted.flow_recent_truncated, false);
});

test("fitOptionsFlowForModel: honestly reports each field's own total even when truncated", () => {
  const flowAlerts = Array.from({ length: 50 }, (_, i) => uwFlowRow(i, 1500));
  const flowRecent = Array.from({ length: 100 }, (_, i) => uwFlowRow(i, 1500));
  const raw = optionsFlowBase(flowAlerts, flowRecent);
  const fitted = fitOptionsFlowForModel(raw);
  assert.equal(fitted.flow_alerts_total, 50);
  assert.equal(fitted.flow_recent_total, 100);
});
