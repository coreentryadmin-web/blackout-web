import test from "node:test";
import assert from "node:assert/strict";
import { buildLiteExecutionSimContract, isOptionQuoteStale } from "./playbook-option-execution-contract";
import { buildOptionExecutionSim } from "./playbook-option-sim";
import type { OptionTicket } from "./spx-play-options";

// BUG FIX (2026-09-03): a quote_timestamp_ms from the future (external provider clock skew, or a
// bad stamp) used to produce a negative age that trivially passed `> optionQuoteMaxAgeSec()`,
// reading an untrustworthy quote as fresh instead of stale.
test("isOptionQuoteStale: a quote timestamped in the future is stale, not freshest-possible", () => {
  const now = Date.parse("2026-09-01T15:00:00.000Z");
  assert.equal(
    isOptionQuoteStale({ quote_timestamp_ms: now + 10 * 60_000 } as never, now),
    true,
    "10 minutes ahead of now is well beyond ordinary clock skew"
  );
});

test("isOptionQuoteStale: a quote a few hundred ms ahead of now (ordinary clock skew) is not stale", () => {
  const now = Date.parse("2026-09-01T15:00:00.000Z");
  assert.equal(isOptionQuoteStale({ quote_timestamp_ms: now + 500 } as never, now), false);
});

test("isOptionQuoteStale: a genuinely old quote is still stale", () => {
  const now = Date.parse("2026-09-01T15:00:00.000Z");
  assert.equal(isOptionQuoteStale({ quote_timestamp_ms: now - 60_000 } as never, now), true);
});

test("isOptionQuoteStale: a fresh quote in the past is not stale", () => {
  const now = Date.parse("2026-09-01T15:00:00.000Z");
  assert.equal(isOptionQuoteStale({ quote_timestamp_ms: now - 2_000 } as never, now), false);
});

const ticket = {
  underlying: "SPXW",
  strike: 5400,
  option_type: "call",
  contract_label: "5400C",
  ticker: "O:SPXW",
  expiration_date: "2026-07-09",
  bid: 2.4,
  ask: 2.6,
  mid: 2.5,
  spread_pct: 8,
  delta: 0.35,
  gamma: 0.02,
  implied_volatility: 0.18,
  volume: 1200,
  open_interest: 1000,
  premium_range: "$2.40–$2.60",
  blocked: false,
  block_reason: null,
} satisfies OptionTicket;

test("buildLiteExecutionSimContract: marks lite_v1 tier and missing full fields", () => {
  const contract = buildLiteExecutionSimContract({
    ticket,
    desk: { price: 5398, polled_at: new Date().toISOString() },
    direction: "long",
    assumed_fill: 2.6,
    exit_assumed_fill: 2.4,
    slippage_pts: 0.1,
    half_spread_pts: 0.1,
    round_trip_cost_pts: 0.2,
  });
  assert.equal(contract.simulator_tier, "lite_v1");
  assert.equal(contract.realism, "research_lite");
  assert.equal(contract.quote.strike, 5400);
  assert.equal(contract.quote.expiration, "2026-07-09");
  assert.ok(contract.missing_for_full_tier.includes("theta") || contract.quote.theta == null);
});

test("buildOptionExecutionSim: attaches contract on happy path", () => {
  const sim = buildOptionExecutionSim(ticket, "long", 5398, {
    price: 5398,
    polled_at: new Date().toISOString(),
  });
  assert.ok(sim);
  assert.equal(sim?.simulator_tier, "lite_v1");
  assert.equal(sim?.contract?.fill_assumption, "adverse_half_spread_plus_bps");
});
