import { test } from "node:test";
import assert from "node:assert/strict";
import { railHitsFromLegacySetup } from "./legacy-bridge";
import type { EnrichedZeroDteSetup } from "../../board";

// ── E6 momentum_abs_floor false-reject fix (docs/audit/0DTE-RESEARCH.md) ──────────────────────
// This is the actual wiring-level regression: `scoreMomentumRail` (rails/momentum.ts) always
// accepted a `change_pct` input, but `railHitsFromLegacySetup` (this file) never read
// `setup.change_pct` when building the call — so the input was dead REGARDLESS of whether
// `EnrichedZeroDteSetup` carried a real value. A unit test against `scoreMomentumRail` directly
// cannot catch this class of bug (the function itself was never broken); it has to go through
// this bridge, the same one `attachThesisFirstLive`/archetype-gates.ts consume live.
function setup(overrides: Partial<EnrichedZeroDteSetup> = {}): EnrichedZeroDteSetup {
  return {
    ticker: "ASTS",
    direction: "long",
    play_type: "DIRECTIONAL",
    discovery_origin: ["BREAKOUT"],
    top_strike: 44,
    expiry: "2026-08-28",
    dte: 0,
    contract_horizon: "ZERO_DTE",
    actual_dte_at_commit: 0,
    grading_policy: "same_day_1530_close",
    net_premium: 0,
    gross_premium: 0,
    prints: 0,
    sweep_pct: 0,
    side_dominance: 0.5,
    underlying_price: 42.5,
    underlying_price_as_of: null,
    underlying_price_source: "chain_spot",
    score: 78,
    dossier_score: null,
    conviction: null,
    direction_confirmed: null,
    factor_breakdown: null,
    trend: null,
    tech_tags: [],
    breakout_zones: [],
    key_supports: [],
    key_resistances: [],
    vwap: null,
    atr14: null,
    rsi14: null,
    // Always null for BREAKOUT-origin — enrichSetup runs with a null dossier for this origin
    // (breakout-source.ts), so `tech?.rel_volume` never resolves.
    rel_volume: null,
    streak_days: null,
    dark_pool_bias: null,
    gex_king_strike: null,
    gamma_regime: null,
    condor: null,
    // Real per-ticker minute-bar read — attachIntradayEdge (scan.ts) attaches this for EVERY
    // origin, so it IS real here, unlike rel_volume.
    intraday: { trend_5m: "up", vwap_dist_pct: null } as any,
    intraday_conflict: false,
    market_aligned: null,
    tod_label: null,
    catalyst_flags: [],
    analyst_note: null,
    fib_note: null,
    plan: null,
    gate: null,
    cortex: null,
    halted: false,
    earnings: null,
    news_hot: null,
    aggression: null,
    otm_pct: 3.5,
    new_money: false,
    recent_premium_30m: 0,
    spike: false,
    first_seen: null,
    last_seen: null,
    flow_quality: null,
    ...overrides,
  } as EnrichedZeroDteSetup;
}

function momentumScore(hits: ReturnType<typeof railHitsFromLegacySetup>): number | null {
  return hits.find((h) => h.rail === "MOMENTUM")?.score ?? null;
}

test("railHitsFromLegacySetup: a BREAKOUT-origin setup with only 5m-trend alignment (no rel_vol, no change_pct) registers a hit BELOW the 60 momentum_abs_floor", () => {
  const s = setup({ change_pct: null });
  const score = momentumScore(railHitsFromLegacySetup(s));
  assert.ok(score != null, "the rail still fires (>=52) on trend alone");
  assert.ok(score! < 60, "but stays under archetype-gates.ts's momentum_abs_floor without a third real input");
});

test("railHitsFromLegacySetup: the SAME setup with its real change_pct populated (as buildBreakoutSetup now does) clears the 60 floor", () => {
  const s = setup({ change_pct: 8.2 }); // a real ~8% breakout day-move, honest, not fabricated
  const score = momentumScore(railHitsFromLegacySetup(s));
  assert.ok(score != null && score >= 60, `expected >=60, got ${score}`);
});
