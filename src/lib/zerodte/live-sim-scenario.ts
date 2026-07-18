/**
 * Scripted mock marks for the 0DTE live-lifecycle demo (dev only).
 * Each step = one ~1s SSE tick. Uses the same entry/stop/target rules as production.
 */

import type { EnrichedZeroDteSetup } from "./board";

export type LiveSimTick = {
  /** Human label for the tick log. */
  label: string;
  /** Option mark ($/share). */
  mark: number;
  bid?: number;
  ask?: number;
  /** Session ET minutes (default: prior + 1 minute compressed). */
  etMinutes?: number;
};

export const LIVE_SIM_ENTRY = 4.2;

/** ~90s real-time replay of a typical NVDA 880C long: OPEN → HOLD → TRIM → giveback. */
export const LIVE_SIM_SCENARIO: LiveSimTick[] = [
  { label: "Ledger commit · flow fill $4.20", mark: 4.2, etMinutes: 10 * 60 + 2 },
  { label: "First live quote · enterable OPEN", mark: 4.28, etMinutes: 10 * 60 + 3 },
  { label: "Mark ticks up · still OPEN", mark: 4.55, etMinutes: 10 * 60 + 5 },
  { label: "Past 3:00 cutoff window · HOLD", mark: 4.72, etMinutes: 15 * 60 + 2 },
  { label: "Drift · HOLD (intel shows trim/stop distances)", mark: 5.1, etMinutes: 11 * 60 + 8 },
  { label: "Momentum · HOLD", mark: 6.2, etMinutes: 11 * 60 + 18 },
  { label: "Approaching +100% target ($8.40)", mark: 7.85, etMinutes: 11 * 60 + 28 },
  { label: "Target tagged · status latches TRIM", mark: 8.52, etMinutes: 11 * 60 + 32 },
  { label: "Pullback after double · still TRIM (sticky)", mark: 6.8, etMinutes: 11 * 60 + 40 },
  { label: "Runner bleeding · TRIM intel warns giveback", mark: 5.4, etMinutes: 12 * 60 + 5 },
  { label: "Still above −50% stop · TRIM hold-or-cut", mark: 4.85, etMinutes: 12 * 60 + 20 },
];

export function spreadAroundMark(mark: number, width = 0.08): { bid: number; ask: number } {
  const half = width / 2;
  return { bid: Math.max(0.01, mark - half), ask: mark + half };
}

export function resolveSimQuote(tick: LiveSimTick): { bid: number; ask: number; mark: number } {
  const mark = tick.mark;
  const spread = spreadAroundMark(mark);
  return {
    mark,
    bid: tick.bid ?? spread.bid,
    ask: tick.ask ?? spread.ask,
  };
}

const today = new Date().toISOString().slice(0, 10);

/** Minimal enriched setup for intel copy (board/Cortex layers frozen in the demo). */
export const LIVE_SIM_MOCK_SETUP: EnrichedZeroDteSetup = {
  ticker: "NVDA",
  direction: "long",
  top_strike: 880,
  expiry: today,
  dte: 0,
  net_premium: 9_600_000,
  gross_premium: 12_400_000,
  prints: 42,
  sweep_pct: 0.61,
  side_dominance: 0.78,
  underlying_price: 878.5,
  score: 91,
  top_strike_avg_fill: LIVE_SIM_ENTRY,
  aggression: 0.72,
  otm_pct: 0.17,
  new_money: true,
  recent_premium_30m: 3_100_000,
  spike: false,
  first_seen: new Date().toISOString(),
  last_seen: new Date().toISOString(),
  dossier_score: 88,
  conviction: "HIGH",
  direction_confirmed: true,
  factor_breakdown: { flow: 28, tech: 12, positioning: 8, news: 4, smart_money: 6 },
  trend: "up",
  tech_tags: ["above_vwap"],
  breakout_zones: ["880C stack"],
  key_supports: [875, 870],
  key_resistances: [885, 890],
  vwap: 876.2,
  atr14: 12.4,
  rsi14: 58,
  rel_volume: 1.35,
  streak_days: 3,
  dark_pool_bias: "bullish",
  gex_king_strike: 875,
  gamma_regime: "short_gamma",
  intraday: {
    vwap: 876.2,
    vwap_dist_pct: 0.26,
    or_high: 877.8,
    or_low: 872.1,
    or_break: "above",
    trend_5m: "up",
    last: 878.5,
    day_high: 879.2,
    day_low: 871.4,
    last_bar_ms: Date.now(),
  },
  intraday_conflict: false,
  market_aligned: true,
  tod_label: "prime window",
  catalyst_flags: [],
  analyst_note: null,
  fib_note: null,
  plan: {
    occ: "O:NVDA260718C00880000",
    flow_avg_fill: LIVE_SIM_ENTRY,
    bid: 4.18,
    ask: 4.22,
    mark: LIVE_SIM_ENTRY,
    entry_max: LIVE_SIM_ENTRY,
    vs_flow_pct: 0,
    entry_status: "IN_RANGE",
    spread_pct: 4,
    illiquid: false,
    stop_premium: LIVE_SIM_ENTRY * 0.5,
    target_premium: LIVE_SIM_ENTRY * 2,
    time_stop_et: "15:30",
    underlying_target: 895,
    underlying_invalid: 865,
  },
  gate: null,
  cortex: null,
  halted: false,
  earnings: null,
  news_hot: null,
};
