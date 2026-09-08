import test from "node:test";
import assert from "node:assert/strict";
import { buildOptionExecutionSim, simulateOptionEntry, simulateOptionExit } from "./playbook-option-sim";
import type { OptionTicket } from "./spx-play-options";

test("simulateOptionEntry: long pays adverse fill above mid", () => {
  const result = simulateOptionEntry({
    entry_spot: 5400,
    option_mid: 2.5,
    spread_width: 0.2,
    direction: "long",
  });
  assert.ok(result.assumed_fill > 2.5);
  assert.ok(result.slippage_pts > 0);
});

// `direction` is the play's underlying stance (long/short), never buy/sell — every SPX Slayer
// play OPENS by buying an option regardless of direction (a short play buys a PUT, it never
// sells one), so a "short" play must pay the exact same adverse-above-mid entry fill as "long".
test("simulateOptionEntry: short ALSO pays adverse fill above mid (opening a short play still buys the put)", () => {
  const long = simulateOptionEntry({ entry_spot: 5400, option_mid: 2.5, spread_width: 0.2, direction: "long" });
  const short = simulateOptionEntry({ entry_spot: 5400, option_mid: 2.5, spread_width: 0.2, direction: "short" });
  assert.ok(short.assumed_fill > 2.5, "a short play still BUYS to enter — fill must be above mid, not below");
  assert.equal(short.assumed_fill, long.assumed_fill, "entry fill must not depend on play direction");
});

// Every play CLOSES by selling the option it bought to enter, regardless of direction — a short
// play's exit is not "buying back a short option", it is selling the put it is long.
test("simulateOptionExit: both long and short pay adverse fill BELOW mid (closing always sells)", () => {
  const long = simulateOptionExit({ entry_spot: 5400, option_mid: 2.5, spread_width: 0.2, direction: "long" });
  const short = simulateOptionExit({ entry_spot: 5400, option_mid: 2.5, spread_width: 0.2, direction: "short" });
  assert.ok(long.assumed_fill < 2.5, "closing a long option always sells — fill must be below mid");
  assert.ok(short.assumed_fill < 2.5, "closing a short play's long put also sells — fill must be below mid, not above");
  assert.equal(short.assumed_fill, long.assumed_fill, "exit fill must not depend on play direction");
});

test("buildOptionExecutionSim: attaches model from ticket quotes", () => {
  const ticket = {
    underlying: "SPX",
    strike: 5400,
    option_type: "call",
    contract_label: "5400C",
    ticker: "O:SPXW",
    bid: 2.4,
    ask: 2.6,
    mid: 2.5,
    spread_pct: 8,
    delta: 0.35,
    open_interest: 1000,
    premium_range: "$2.40–$2.60",
    blocked: false,
    block_reason: null,
  } satisfies OptionTicket;

  const sim = buildOptionExecutionSim(ticket, "long", 5398, {
    price: 5398,
    polled_at: new Date().toISOString(),
  });
  assert.ok(sim);
  assert.equal(sim?.model, "adverse_half_spread_plus_bps");
  assert.equal(sim?.simulator_tier, "lite_v1");
  assert.ok(sim!.exit_assumed_fill != null);
  assert.ok(sim!.round_trip_cost_pts != null);
  assert.ok(sim!.round_trip_cost_pts! > sim!.slippage_pts);
  assert.ok(sim!.contract);
});
