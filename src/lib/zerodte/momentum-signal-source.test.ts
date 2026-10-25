import test from "node:test";
import assert from "node:assert/strict";
import {
  momentumScore,
  momentumScoreBreakdown,
  buildMomentumSetup,
  momentumSrcFlagEnabled,
  momentumSourceEnabled,
  MOMENTUM_SCORE_BASE,
} from "./momentum-signal-source.ts";
import type { MomentumSignalCandidate } from "./momentum-signal.ts";
import type { MomentumAccelerationRead } from "./momentum-acceleration.ts";
import { mergeDiscoveryOrigins } from "./breakout-source.ts";

function candidate(overrides: Partial<MomentumSignalCandidate> = {}): MomentumSignalCandidate {
  return {
    ticker: "AAPL",
    direction: "long",
    strike: 101,
    side: "call",
    ask: 0.6,
    mid: 0.55,
    spread_pct: 10,
    oi: 500,
    distance_pct: 1,
    reachability_prob: 0.5,
    target_premium: 20,
    required_underlying_price: 121,
    required_move_pct: 25,
    target_reachability_prob: 0.3,
    rank_score: 0.3,
    ...overrides,
  };
}

function momentum(overrides: Partial<MomentumAccelerationRead> = {}): MomentumAccelerationRead {
  return {
    direction: "up",
    recent_move_pct: 0.6,
    prior_move_pct: 0.1,
    accelerating: true,
    key_level_break: "above",
    confirmed: true,
    ...overrides,
  };
}

test("momentumScore: base-only (no move, no rvol, no reachability, no spread data) equals MOMENTUM_SCORE_BASE", () => {
  const c = candidate({ reachability_prob: null, spread_pct: null });
  const m = momentum({ recent_move_pct: null });
  assert.equal(momentumScore(c, m, null), MOMENTUM_SCORE_BASE);
});

test("momentumScore: a bigger confirmed move scores strictly higher, all else equal", () => {
  const small = momentumScore(candidate(), momentum({ recent_move_pct: 0.1 }), 2);
  const big = momentumScore(candidate(), momentum({ recent_move_pct: 1.5 }), 2);
  assert.ok(big > small, `expected a bigger move to score higher: ${small} vs ${big}`);
});

test("momentumScore: higher RVOL scores strictly higher, all else equal", () => {
  const low = momentumScore(candidate(), momentum(), 1.5);
  const high = momentumScore(candidate(), momentum(), 4);
  assert.ok(high > low, `expected higher RVOL to score higher: ${low} vs ${high}`);
});

test("momentumScore: higher strike reachability scores strictly higher, all else equal", () => {
  const far = momentumScore(candidate({ reachability_prob: 0.05 }), momentum(), 2);
  const near = momentumScore(candidate({ reachability_prob: 0.9 }), momentum(), 2);
  assert.ok(near > far, `expected higher reachability to score higher: ${far} vs ${near}`);
});

test("momentumScore: a tighter spread scores strictly higher, all else equal", () => {
  const wide = momentumScore(candidate({ spread_pct: 45 }), momentum(), 2);
  const tight = momentumScore(candidate({ spread_pct: 2 }), momentum(), 2);
  assert.ok(tight > wide, `expected a tighter spread to score higher: ${wide} vs ${tight}`);
});

test("momentumScore: clamps to [0, 100]", () => {
  const maxed = momentumScore(candidate({ reachability_prob: 1, spread_pct: 0 }), momentum({ recent_move_pct: 5 }), 10);
  assert.ok(maxed <= 100 && maxed >= 0);
});

test("momentumScoreBreakdown: component points reconcile EXACTLY to the headline score", () => {
  const c = candidate();
  const m = momentum();
  const { score, factors } = momentumScoreBreakdown(c, m, 2.5);
  const sum = Object.values(factors).reduce((a, b) => a + b, 0);
  assert.equal(sum, score, `factor points (${JSON.stringify(factors)}) must sum to the score (${score})`);
  assert.ok("momentum_core" in factors);
  assert.ok("relative_volume" in factors);
  assert.ok("strike_reachability" in factors);
  assert.ok("spread_quality" in factors);
  assert.ok("screen_base" in factors);
});

test("buildMomentumSetup: discovery_origin is [\"MOMENTUM\"], always same-day (dte=0, ZERO_DTE)", () => {
  const setup = buildMomentumSetup({
    ticker: "aapl",
    candidate: candidate(),
    momentum: momentum(),
    rvolRatio: 2.5,
    spot: 100,
    todayYmd: "2026-10-25",
  });
  assert.deepEqual(setup.discovery_origin, ["MOMENTUM"]);
  assert.equal(setup.ticker, "AAPL", "ticker is upper-cased");
  assert.equal(setup.dte, 0);
  assert.equal(setup.contract_horizon, "ZERO_DTE");
  assert.equal(setup.actual_dte_at_commit, 0);
  assert.equal(setup.expiry, "2026-10-25");
  assert.equal(setup.play_type, "DIRECTIONAL");
});

test("buildMomentumSetup: a long (call) setup has a positive otm_pct when the strike is above spot", () => {
  const setup = buildMomentumSetup({
    ticker: "AAPL",
    candidate: candidate({ direction: "long", strike: 105, side: "call" }),
    momentum: momentum({ direction: "up" }),
    rvolRatio: 2.5,
    spot: 100,
    todayYmd: "2026-10-25",
  });
  assert.equal(setup.direction, "long");
  assert.equal(setup.otm_pct, 5);
});

test("buildMomentumSetup: a short (put) setup has a positive otm_pct when the strike is below spot", () => {
  const setup = buildMomentumSetup({
    ticker: "AAPL",
    candidate: candidate({ direction: "short", strike: 95, side: "put" }),
    momentum: momentum({ direction: "down", recent_move_pct: -0.6, key_level_break: "below" }),
    rvolRatio: 2.5,
    spot: 100,
    todayYmd: "2026-10-25",
  });
  assert.equal(setup.direction, "short");
  assert.equal(setup.otm_pct, 5);
});

test("buildMomentumSetup: carries honest neutral/null flow fields, never fabricated", () => {
  const setup = buildMomentumSetup({
    ticker: "AAPL",
    candidate: candidate(),
    momentum: momentum(),
    rvolRatio: 2.5,
    spot: 100,
    todayYmd: "2026-10-25",
  });
  assert.equal(setup.net_premium, 0);
  assert.equal(setup.gross_premium, 0);
  assert.equal(setup.prints, 0);
  assert.equal(setup.sweep_pct, 0);
  assert.equal(setup.side_dominance, 0.5);
  assert.equal(setup.aggression, null);
  assert.equal(setup.flow_quality, null);
  assert.equal(setup.first_seen, null);
  assert.equal(setup.last_seen, null);
  assert.equal(setup.new_money, false);
  assert.equal(setup.spike, false);
});

test("buildMomentumSetup: change_pct is the ABS magnitude of the confirmed recent move", () => {
  const setup = buildMomentumSetup({
    ticker: "AAPL",
    candidate: candidate({ direction: "short" }),
    momentum: momentum({ recent_move_pct: -0.83 }),
    rvolRatio: 2.5,
    spot: 100,
    todayYmd: "2026-10-25",
  });
  assert.equal(setup.change_pct, 0.83);
});

test("buildMomentumSetup: underlying_price/source carry the real spot, never fabricated as-of", () => {
  const setup = buildMomentumSetup({
    ticker: "AAPL",
    candidate: candidate(),
    momentum: momentum(),
    rvolRatio: 2.5,
    spot: 123.456,
    todayYmd: "2026-10-25",
  });
  assert.equal(setup.underlying_price, 123.46);
  assert.equal(setup.underlying_price_source, "chain_spot");
  assert.equal(setup.underlying_price_as_of, null);
});

test("buildMomentumSetup: a MOMENTUM setup merges cleanly with a FLOW setup via the shared mergeDiscoveryOrigins", () => {
  const flow = {
    ticker: "AAPL",
    direction: "long",
    discovery_origin: ["FLOW"],
    score: 70,
    play_type: "DIRECTIONAL",
  } as any;
  const mom = buildMomentumSetup({
    ticker: "AAPL",
    candidate: candidate({ direction: "long" }),
    momentum: momentum(),
    rvolRatio: 2.5,
    spot: 100,
    todayYmd: "2026-10-25",
  });
  const merged = mergeDiscoveryOrigins([flow], [mom]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0]!.discovery_origin, ["FLOW", "MOMENTUM"]);
});

test("momentumSrcFlagEnabled / momentumSourceEnabled: ON by default, OFF when ZERODTE_SRC_MOMENTUM=0", () => {
  const prevSrc = process.env.ZERODTE_SRC_MOMENTUM;
  const prevMaster = process.env.ZERODTE_WHOLE_MARKET;
  try {
    delete process.env.ZERODTE_SRC_MOMENTUM;
    delete process.env.ZERODTE_WHOLE_MARKET;
    assert.equal(momentumSrcFlagEnabled(), true);
    assert.equal(momentumSourceEnabled(), true);
    process.env.ZERODTE_SRC_MOMENTUM = "0";
    assert.equal(momentumSrcFlagEnabled(), false);
    assert.equal(momentumSourceEnabled(), false);
  } finally {
    if (prevSrc === undefined) delete process.env.ZERODTE_SRC_MOMENTUM;
    else process.env.ZERODTE_SRC_MOMENTUM = prevSrc;
    if (prevMaster === undefined) delete process.env.ZERODTE_WHOLE_MARKET;
    else process.env.ZERODTE_WHOLE_MARKET = prevMaster;
  }
});

test("momentumSourceEnabled: OFF when the shared ZERODTE_WHOLE_MARKET master switch is off", () => {
  const prevMaster = process.env.ZERODTE_WHOLE_MARKET;
  try {
    process.env.ZERODTE_WHOLE_MARKET = "0";
    assert.equal(momentumSourceEnabled(), false);
  } finally {
    if (prevMaster === undefined) delete process.env.ZERODTE_WHOLE_MARKET;
    else process.env.ZERODTE_WHOLE_MARKET = prevMaster;
  }
});
