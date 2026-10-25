import test from "node:test";
import assert from "node:assert/strict";
import {
  earlyEntryScore,
  earlyEntryScoreBreakdown,
  buildEarlyEntrySetup,
  earlyEntrySrcFlagEnabled,
  earlyEntrySourceEnabled,
  EARLY_ENTRY_SCORE_BASE,
} from "./early-entry-source.ts";
import type { EarlyEntryCandidate } from "./early-entry-contract-select.ts";
import type { PressureRead } from "./early-entry-pressure.ts";
import type { EarlyEntryAlert } from "./early-entry-alert.ts";

function candidate(overrides: Partial<EarlyEntryCandidate> = {}): EarlyEntryCandidate {
  return {
    strike: 112, side: "call", ask: 1.8, bid: 1.7, mid: 1.75, spread_pct: 10, oi: 400, iv: 0.35,
    distance_pct: 1.8, expected_move_pct: 2.5, reachability_prob: 0.4, captured_fraction: 0.1,
    rank_score: 0.35, ...overrides,
  };
}
function pressure(overrides: Partial<PressureRead> = {}): PressureRead {
  return {
    developing: true, compression: null, rvol_ratio: 2.1, rvol_confirmed: true, level: 110,
    level_tests: 3, distance_to_level_pct: 0.6, order_flow_bias: 0.2, ...overrides,
  };
}

test("earlyEntryScore: base-only (no reachability, max captured, no spread data, no level tests) stays low", () => {
  const c = candidate({ reachability_prob: null, captured_fraction: 1, spread_pct: null });
  const s = earlyEntryScore(c, { level_tests: 0 });
  assert.equal(s, EARLY_ENTRY_SCORE_BASE);
});

test("earlyEntryScore: higher reachability scores strictly higher, all else equal", () => {
  const low = earlyEntryScore(candidate({ reachability_prob: 0.05 }), pressure());
  const high = earlyEntryScore(candidate({ reachability_prob: 0.9 }), pressure());
  assert.ok(high > low);
});

test("earlyEntryScore: more room left (lower captured_fraction) scores strictly higher", () => {
  const extended = earlyEntryScore(candidate({ captured_fraction: 0.55 }), pressure());
  const fresh = earlyEntryScore(candidate({ captured_fraction: -0.2 }), pressure());
  assert.ok(fresh > extended);
});

test("earlyEntryScore: a tighter spread scores strictly higher", () => {
  const wide = earlyEntryScore(candidate({ spread_pct: 45 }), pressure());
  const tight = earlyEntryScore(candidate({ spread_pct: 2 }), pressure());
  assert.ok(tight > wide);
});

test("earlyEntryScore: more confirmed level tests scores strictly higher, saturating at EARLY_ENTRY_LEVEL_TESTS_FULL", () => {
  const few = earlyEntryScore(candidate(), pressure({ level_tests: 1 }));
  const many = earlyEntryScore(candidate(), pressure({ level_tests: 5 }));
  const tooMany = earlyEntryScore(candidate(), pressure({ level_tests: 50 }));
  assert.ok(many > few);
  assert.equal(many, tooMany, "saturates -- a 50th test is no more informative than the 5th");
});

test("earlyEntryScore: clamps to [0, 100]", () => {
  const maxed = earlyEntryScore(candidate({ reachability_prob: 1, captured_fraction: -5, spread_pct: 0 }), pressure({ level_tests: 99 }));
  assert.ok(maxed <= 100 && maxed >= 0);
});

test("earlyEntryScoreBreakdown: component points reconcile EXACTLY to the headline score", () => {
  const { score, factors } = earlyEntryScoreBreakdown(candidate(), pressure());
  const sum = Object.values(factors).reduce((a, b) => a + b, 0);
  assert.equal(sum, score);
  for (const key of ["strike_reachability", "room_to_run", "spread_quality", "level_test_conviction", "screen_base"]) {
    assert.ok(key in factors, `missing factor ${key}`);
  }
});

function alert(overrides: Partial<EarlyEntryAlert> = {}): EarlyEntryAlert {
  return {
    state: "ENTRY", ticker: "aapl", direction: "long", level: 110, invalidation_level: 108,
    trigger_price: 110.11, entry_triggered_at_ms: 9_000, underlying_spot_now: 110.5,
    underlying_targets: [{ label: "the level it broke", price: 110 }],
    contract: { strike: 112, side: "call", bid: 1.7, ask: 1.8, quote_as_of_ms: null, oi: 400, iv: 0.35 },
    rejected_alternatives: [], why_now: "broke out", value_scenarios: null,
    ...overrides,
  };
}

test("buildEarlyEntrySetup: discovery_origin stays [\"MOMENTUM\"], always same-day", () => {
  const setup = buildEarlyEntrySetup({ alert: alert(), candidate: candidate(), pressure: pressure(), todayYmd: "2026-10-25" });
  assert.deepEqual(setup.discovery_origin, ["MOMENTUM"]);
  assert.equal(setup.ticker, "AAPL");
  assert.equal(setup.dte, 0);
  assert.equal(setup.contract_horizon, "ZERO_DTE");
  assert.equal(setup.expiry, "2026-10-25");
});

test("buildEarlyEntrySetup: a long setup's otm_pct is positive when the strike is above spot", () => {
  const setup = buildEarlyEntrySetup({
    alert: alert({ direction: "long", underlying_spot_now: 110 }),
    candidate: candidate({ strike: 112 }), pressure: pressure(), todayYmd: "2026-10-25",
  });
  assert.ok(setup.otm_pct! > 0);
});

test("buildEarlyEntrySetup: a short setup's otm_pct is positive when the strike is below spot", () => {
  const setup = buildEarlyEntrySetup({
    alert: alert({ direction: "short", underlying_spot_now: 90 }),
    candidate: candidate({ strike: 88, side: "put" }), pressure: pressure(), todayYmd: "2026-10-25",
  });
  assert.ok(setup.otm_pct! > 0);
});

test("buildEarlyEntrySetup: honest neutral/null flow fields, never fabricated", () => {
  const setup = buildEarlyEntrySetup({ alert: alert(), candidate: candidate(), pressure: pressure(), todayYmd: "2026-10-25" });
  assert.equal(setup.net_premium, 0);
  assert.equal(setup.gross_premium, 0);
  assert.equal(setup.aggression, null);
  assert.equal(setup.flow_quality, null);
  assert.equal(setup.first_seen, null);
});

test("buildEarlyEntrySetup: change_pct comes from the pressure read's distance_to_level_pct, and is null without a pressure read", () => {
  const withPressure = buildEarlyEntrySetup({ alert: alert(), candidate: candidate(), pressure: pressure({ distance_to_level_pct: -0.42 }), todayYmd: "2026-10-25" });
  assert.equal(withPressure.change_pct, 0.42);
  const noPressure = buildEarlyEntrySetup({ alert: alert(), candidate: candidate(), pressure: null, todayYmd: "2026-10-25" });
  assert.equal(noPressure.change_pct, null);
});

test("earlyEntrySrcFlagEnabled / earlyEntrySourceEnabled: ON by default, OFF when ZERODTE_SRC_MOMENTUM=0", () => {
  const prev = process.env.ZERODTE_SRC_MOMENTUM;
  try {
    delete process.env.ZERODTE_SRC_MOMENTUM;
    assert.equal(earlyEntrySrcFlagEnabled(), true);
    assert.equal(earlyEntrySourceEnabled(), true);
    process.env.ZERODTE_SRC_MOMENTUM = "0";
    assert.equal(earlyEntrySrcFlagEnabled(), false);
  } finally {
    if (prev === undefined) delete process.env.ZERODTE_SRC_MOMENTUM;
    else process.env.ZERODTE_SRC_MOMENTUM = prev;
  }
});
