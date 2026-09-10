// Regression for the recap_summary double-period bug (2026-09-10 5-engine live monitor sweep):
// GET /api/market/nighthawk/edition served "Market tide unavailable.. SPX ..." to every member
// and Largo caller whenever ctx.tide was null, because tideSummary() baked its own trailing
// period into two of its three branches while buildMarketRecap's summary template also appended
// one (`${tide}. ${spx}.`). The third branch (a real computed tide) never had a trailing period,
// so the bug was branch-specific, not a universal template issue.
import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketRecap } from "./format";
import type { MarketWideContext } from "./market-wide";

function baseCtx(overrides: Partial<MarketWideContext> = {}): MarketWideContext {
  return {
    today: "2026-09-09",
    tomorrow: "2026-09-10",
    tide: null,
    stock_flows: [],
    hot_chains: [],
    index_flows: {},
    spx_bars: [{ o: 7670, h: 7680, l: 7620, c: 7636.36, t: 1 }],
    spx_intraday_5m: [],
    spx_gap: null,
    vix_bars: [{ o: 15.7, h: 16.6, l: 15.6, c: 16.46, t: 1 }],
    market_news: [],
    macro_events: [],
    tomorrow_earnings: [],
    sector_tides: [],
    etf_tides: {},
    sector_performance: [],
    top_net_impact: [],
    vix_term: [],
    vix_iv_rank: null,
    market_breadth: null,
    predictions_consensus: [],
    mag7_greek_flow: null,
    macro_indicators: [],
    after_hours_catalysts: [],
    total_options_volume: null,
    market_oi_change: [],
    platform_intel: null,
    unusual_trades: [],
    market_movers: [],
    breakout_movers: [],
    ...overrides,
  };
}

test("recap summary never double-periods when tide is unavailable", () => {
  const { summary, tide } = buildMarketRecap(baseCtx({ tide: null }));
  assert.equal(tide, "Market tide unavailable");
  assert.ok(!summary.includes(".."), `expected no double period, got: ${summary}`);
  assert.ok(summary.startsWith("Market tide unavailable. SPX"));
});

test("recap summary never double-periods when tide is flat/zero", () => {
  const { summary, tide } = buildMarketRecap(baseCtx({ tide: { call_premium: 0, put_premium: 0 } }));
  assert.equal(tide, "Market tide flat / no premium");
  assert.ok(!summary.includes(".."), `expected no double period, got: ${summary}`);
});

test("recap summary still reads correctly for a real computed tide", () => {
  const { summary, tide } = buildMarketRecap(
    baseCtx({ tide: { call_premium: 6_000_000, put_premium: 4_000_000 } })
  );
  assert.equal(tide, "BULLISH — calls 60% ($6.0M) vs puts $4.0M");
  assert.ok(!summary.includes(".."), `expected no double period, got: ${summary}`);
  assert.ok(summary.startsWith("BULLISH — calls 60% ($6.0M) vs puts $4.0M. SPX"));
});
