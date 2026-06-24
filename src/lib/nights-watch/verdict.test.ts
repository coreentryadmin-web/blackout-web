import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVerdict, VERDICT_THRESHOLDS } from "./verdict";
import type { EnrichedPosition, ContractValuation } from "./valuation";
import type { PositionContext } from "./position-context";
import type { UserPositionRow } from "@/lib/db";
import type { GexWall } from "@/lib/providers/gamma-desk";

// The SHORT-side guards are the whole point of these tests: the SAME market move
// means OPPOSITE things to a long vs a short holder. A long fears
// expiry-worthless + theta decay + deep loss + assignment-as-ITM; a short WANTS
// expiry/theta (it collects premium) and instead fears assignment. Each test
// asserts BOTH verdict.action AND signal membership so a regression that flips a
// short into a long-style verdict can never pass silently.

// --- factories ---------------------------------------------------------------

function makeValuation(overrides: Partial<ContractValuation> = {}): ContractValuation {
  return {
    mark: 5,
    bid: 4.9,
    ask: 5.1,
    delta: 0.5,
    gamma: 0.02,
    theta: -0.05,
    iv: 0.3,
    openInterest: 1000,
    underlyingPrice: 105,
    mark_source: "snapshot",
    ...overrides,
  };
}

const BASE_ROW: UserPositionRow = {
  id: 1,
  ticker: "AAPL",
  option_type: "call",
  strike: 100,
  expiry: "2026-07-17",
  side: "long",
  contracts: 1,
  entry_premium: 5,
  entry_date: "2026-06-01",
  status: "open",
  exit_premium: null,
  notes: null,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
  closed_at: null,
};

/**
 * Full EnrichedPosition with sane "live, neutral, nothing-firing" defaults:
 * comfortable DTE so the expiry block is skipped, neutral pnl (no gain/loss
 * signal), moderate delta below HEALTHY. Tests override only what they isolate.
 * NOTE: dte=14 deliberately also fires "comfortable_dte" (a hold signal) so that
 * the otherwise-neutral baseline resolves; tests that must isolate a hold signal
 * either accept comfortable_dte alongside it or lower dte explicitly.
 */
function makeEnriched(overrides: Partial<EnrichedPosition> = {}): EnrichedPosition {
  const valuation =
    overrides.valuation !== undefined ? overrides.valuation : makeValuation();
  return {
    ...BASE_ROW,
    valuation_status: "live",
    valuation,
    current_value: 500,
    unrealized_pnl: 0,
    pnl_pct: 0,
    dte: 14,
    breakeven: 105,
    pct_to_breakeven: null,
    distance_to_strike_pct: null,
    ...overrides,
  };
}

function makeContext(overrides: Partial<PositionContext> = {}): PositionContext {
  return {
    source: "none",
    underlyingPrice: null,
    gammaRegime: null,
    regime: null,
    gammaFlip: null,
    maxPain: null,
    gexWalls: [],
    keyLevels: [],
    ...overrides,
  };
}

function wall(overrides: Partial<GexWall> = {}): GexWall {
  return {
    strike: 5980,
    net_gex: -1_000_000,
    kind: "support",
    distance_pts: 0,
    ...overrides,
  };
}

// --- no live data ------------------------------------------------------------

test("not live → action 'watch', signals ['no_live_data']", () => {
  for (const status of ["pending", "unavailable"] as const) {
    const v = computeVerdict(makeEnriched({ valuation_status: status, valuation: null }));
    assert.equal(v.action, "watch");
    assert.deepEqual(v.signals, ["no_live_data"]);
  }
});

// --- expiry zone (the core 4-quadrant guard) ---------------------------------

test("LONG call OTM at 0DTE → 'sell' + 'expiry_worthless_risk'", () => {
  const v = computeVerdict(
    makeEnriched({
      side: "long",
      option_type: "call",
      strike: 100,
      dte: 0,
      valuation: makeValuation({ underlyingPrice: 95, delta: 0.1 }),
    })
  );
  assert.equal(v.action, "sell");
  assert.ok(v.signals.includes("expiry_worthless_risk"));
});

test("REGRESSION: SHORT call OTM at 0DTE → 'hold' + 'expiry_capture', NEVER worthless_risk/sell", () => {
  const v = computeVerdict(
    makeEnriched({
      side: "short",
      option_type: "call",
      strike: 100,
      dte: 0,
      pnl_pct: 0,
      valuation: makeValuation({ underlyingPrice: 95, delta: 0.1, theta: -0.001 }),
    })
  );
  assert.ok(v.signals.includes("expiry_capture"));
  assert.ok(!v.signals.includes("expiry_worthless_risk"));
  assert.notEqual(v.action, "sell");
  assert.equal(v.action, "hold");
});

test("SHORT call ITM at 0DTE → 'sell' + 'expiry_assignment_risk'", () => {
  const v = computeVerdict(
    makeEnriched({
      side: "short",
      option_type: "call",
      strike: 100,
      dte: 0,
      pnl_pct: 0,
      valuation: makeValuation({ underlyingPrice: 110, delta: 0.8 }),
    })
  );
  assert.equal(v.action, "sell");
  assert.ok(v.signals.includes("expiry_assignment_risk"));
});

// --- theta -------------------------------------------------------------------

test("LONG theta -0.50 / mark 1.00 / 1DTE → 'trim' + 'theta_decay'", () => {
  // burn = 0.50/1.00 = 50% >> THETA_BURN_FRACTION; dte 1 <= LOW_DTE.
  // OTM + 1DTE would also fire expiry_worthless_risk (sell) and mask trim, so keep
  // it ITM (underlying 110 > strike 100) and low |delta|-free to isolate theta.
  const v = computeVerdict(
    makeEnriched({
      side: "long",
      option_type: "call",
      strike: 100,
      dte: 1,
      pnl_pct: 0,
      valuation: makeValuation({ mark: 1.0, theta: -0.5, underlyingPrice: 110, delta: 0.6 }),
    })
  );
  assert.ok(v.signals.includes("theta_decay"));
  assert.equal(v.action, "trim");
});

test("REGRESSION: SHORT theta -0.50 / mark 1.00 / 1DTE (ITM, not assignment-free) → 'theta_tailwind', NEVER theta_decay/trim-from-theta", () => {
  // SHORT call ITM at 1DTE: expiry_assignment_risk (sell) would mask, so to isolate
  // theta we keep it OTM. But OTM short at 1DTE fires expiry_capture (hold). theta
  // for a short is a HOLD signal (tailwind), so action stays hold — the guard is
  // that theta_decay/trim NEVER appears for a short.
  const v = computeVerdict(
    makeEnriched({
      side: "short",
      option_type: "call",
      strike: 100,
      dte: 1,
      pnl_pct: 0,
      valuation: makeValuation({ mark: 1.0, theta: -0.5, underlyingPrice: 95, delta: 0.1 }),
    })
  );
  assert.ok(v.signals.includes("theta_tailwind"));
  assert.ok(!v.signals.includes("theta_decay"));
  assert.notEqual(v.action, "trim");
});

// --- deep loss (side-aware floor) --------------------------------------------

test("LONG pnl_pct -70 → 'sell' + 'deep_loss'", () => {
  const v = computeVerdict(
    makeEnriched({ side: "long", pnl_pct: -70, dte: 14 })
  );
  assert.equal(v.action, "sell");
  assert.ok(v.signals.includes("deep_loss"));
});

test("REGRESSION: SHORT pnl_pct -70 → NO 'deep_loss' (short floor is -150)", () => {
  const v = computeVerdict(
    makeEnriched({ side: "short", pnl_pct: -70, dte: 14, breakeven: null })
  );
  assert.ok(!v.signals.includes("deep_loss"));
});

test("SHORT pnl_pct -160 → 'deep_loss' (past the -150 short floor)", () => {
  const v = computeVerdict(
    makeEnriched({ side: "short", pnl_pct: -160, dte: 14, breakeven: null })
  );
  assert.equal(v.action, "sell");
  assert.ok(v.signals.includes("deep_loss"));
});

// --- gains (side-aware "strong" line) ----------------------------------------

test("LONG pnl_pct 110 → 'gain_lock_strong'", () => {
  const v = computeVerdict(makeEnriched({ side: "long", pnl_pct: 110, dte: 14 }));
  assert.ok(v.signals.includes("gain_lock_strong"));
  assert.ok(!v.signals.includes("gain_lock") || v.signals.includes("gain_lock_strong"));
});

test("SHORT pnl_pct 90 → 'gain_lock_strong' (>= short strong line 85)", () => {
  const v = computeVerdict(
    makeEnriched({ side: "short", pnl_pct: 90, dte: 14, breakeven: null })
  );
  assert.ok(v.signals.includes("gain_lock_strong"));
});

test("SHORT pnl_pct 60 → 'gain_lock' (not strong; >= 50 but < short strong 85)", () => {
  const v = computeVerdict(
    makeEnriched({ side: "short", pnl_pct: 60, dte: 14, breakeven: null })
  );
  assert.ok(v.signals.includes("gain_lock"));
  assert.ok(!v.signals.includes("gain_lock_strong"));
});

// --- healthy delta (long-only hold signal) -----------------------------------

test("LONG |delta| 0.40 at comfortable DTE → 'hold' + 'healthy_delta'", () => {
  const v = computeVerdict(
    makeEnriched({
      side: "long",
      dte: 14,
      pnl_pct: 0,
      valuation: makeValuation({ delta: 0.4, underlyingPrice: 105 }),
    })
  );
  assert.equal(v.action, "hold");
  assert.ok(v.signals.includes("healthy_delta"));
});

test("REGRESSION: SHORT |delta| 0.40 → NEVER 'healthy_delta'", () => {
  const v = computeVerdict(
    makeEnriched({
      side: "short",
      dte: 14,
      pnl_pct: 0,
      breakeven: null,
      valuation: makeValuation({ delta: 0.4, underlyingPrice: 105 }),
    })
  );
  assert.ok(!v.signals.includes("healthy_delta"));
});

// --- GEX wall break margin ----------------------------------------------------
// LONG call (wantsUp) with a SUPPORT wall below: a decisive drop below support is
// the break. WALL_BREAK_PTS guards against a hair-trigger when spot is merely a
// tick under the wall.

test("wall break: LONG call, support wall 5980, spot 5979 (within WALL_BREAK_PTS) → NO 'gex_wall_broken_against'", () => {
  const spot = 5980 - 1; // 5979: well within the 15pt margin
  const ctx = makeContext({
    source: "gex-heatmap",
    underlyingPrice: spot,
    gexWalls: [wall({ strike: 5980, kind: "support" })],
  });
  // Position must be otherwise non-triggering: high DTE (no expiry block, no
  // comfortable_dte interference is fine), neutral pnl, strike far so not OTM-expiry.
  const v = computeVerdict(
    makeEnriched({
      side: "long",
      option_type: "call",
      strike: 5900,
      dte: 30,
      pnl_pct: 0,
      breakeven: null,
      pct_to_breakeven: null,
      valuation: makeValuation({ underlyingPrice: spot, delta: 0.25, theta: -0.001 }),
    }),
    ctx
  );
  assert.ok(!v.signals.includes("gex_wall_broken_against"));
  // sanity: margin must be the reason — confirm a decisive break WOULD fire (next test)
  assert.ok(spot > 5980 - VERDICT_THRESHOLDS.WALL_BREAK_PTS);
});

test("wall break: LONG call, support wall 5980, spot 5960 (decisively below) → 'gex_wall_broken_against' + 'sell'", () => {
  const spot = 5960; // 20pt below 5980 → past the 15pt margin
  const ctx = makeContext({
    source: "gex-heatmap",
    underlyingPrice: spot,
    gexWalls: [wall({ strike: 5980, kind: "support" })],
  });
  const v = computeVerdict(
    makeEnriched({
      side: "long",
      option_type: "call",
      strike: 5900,
      dte: 30,
      pnl_pct: 0,
      breakeven: null,
      pct_to_breakeven: null,
      valuation: makeValuation({ underlyingPrice: spot, delta: 0.25, theta: -0.001 }),
    }),
    ctx
  );
  assert.ok(v.signals.includes("gex_wall_broken_against"));
  assert.equal(v.action, "sell");
  assert.ok(spot < 5980 - VERDICT_THRESHOLDS.WALL_BREAK_PTS);
});
