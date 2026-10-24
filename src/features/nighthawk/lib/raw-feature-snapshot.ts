/**
 * Night Hawk Legacy — raw pre-selection feature capture (Workstream C / #20's D3, 2026-09-21).
 *
 * `scoredCandidateSnapshotPayload` (scorer.ts) already persists the DERIVED per-dimension SCORES
 * (flow_score, tech_score, ...) at scoring-stage capture, but not the raw underlying VALUES those
 * scores were computed from — a future Winner-DNA feature-attribution pass needs the raw values,
 * not just the scores they were folded into. This is a pure, additive read of fields already
 * fully populated on `TickerDossier` at scoring time — no new fetch, no threading through
 * scorer.ts. Every field is captured HONESTLY: absent/null upstream data stays null here, never
 * fabricated, and array-shaped raw feeds (congress trades, institutional activity, OI-change rows)
 * are captured as COUNTS rather than full raw payloads, to keep the snapshot row small.
 */

import type { TickerDossier } from "./dossier";

export type RawFeatureSnapshot = {
  schema_version: 1;
  // Technical / momentum (TechnicalCard)
  rvol: number | null;
  rsi14: number | null;
  atr14: number | null;
  vwap: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  trend: string | null;
  setup_tags: string[];
  // Dealer / gamma positioning (PositioningSummary)
  net_gex: number | null;
  gex_king_strike: number | null;
  gamma_flip: number | null;
  gamma_regime: string | null;
  net_vex: number | null;
  max_pain: number | null;
  negative_gamma: boolean | null;
  // Dark pool
  dark_pool_total_premium: number | null;
  dark_pool_bias: string | null;
  // Options-derived
  risk_reversal_skew: number | null;
  iv_rank: number | null;
  short_days_to_cover: number | null;
  oi_change_count: number;
  // Smart money / catalysts — counts only, never the full raw feed
  congress_trade_count: number;
  congress_unusual_count: number;
  institutional_activity_count: number;
  predictions_signal_present: boolean;
  catalyst_count: number;
  // Analyst
  benzinga_price_target: { price_target: number; firm: string | null; action: string | null } | null;
  // Fundamentals — presence only (the ratios/signals objects are large and already captured
  // in full wherever fundamental_score/fundamental_flags are derived from them)
  fundamental_ratios_present: boolean;
  fundamental_signals_present: boolean;
  sector: string | null;
};

type DarkPoolShape = { total_premium?: number | null; bias?: string | null } | null | undefined;

export function buildRawFeatureSnapshot(dossier: TickerDossier | null | undefined): RawFeatureSnapshot | null {
  if (!dossier) return null;
  const tech = dossier.tech;
  const positioning = dossier.positioning;
  const darkPool = dossier.dark_pool as DarkPoolShape;
  const pt = dossier.benzinga_price_target;

  return {
    schema_version: 1,
    rvol: tech?.rel_volume ?? null,
    rsi14: tech?.rsi14 ?? null,
    atr14: tech?.atr14 ?? null,
    vwap: tech?.vwap ?? null,
    ema20: tech?.ema20 ?? null,
    ema50: tech?.ema50 ?? null,
    ema200: tech?.ema200 ?? null,
    trend: tech?.trend ?? null,
    setup_tags: tech?.setup_tags ?? [],
    net_gex: positioning?.net_gex ?? null,
    gex_king_strike: positioning?.gex_king_strike ?? null,
    gamma_flip: positioning?.gamma_flip ?? null,
    gamma_regime: positioning?.gamma_regime ?? null,
    net_vex: positioning?.net_vex ?? null,
    max_pain: positioning?.max_pain ?? null,
    negative_gamma: positioning?.negative_gamma ?? null,
    dark_pool_total_premium: darkPool?.total_premium ?? null,
    dark_pool_bias: darkPool?.bias ?? null,
    risk_reversal_skew: dossier.risk_reversal_skew ?? null,
    iv_rank: dossier.iv_rank ?? null,
    short_days_to_cover: dossier.short_days_to_cover ?? null,
    oi_change_count: dossier.oi_change?.length ?? 0,
    congress_trade_count: dossier.congress_trades?.length ?? 0,
    congress_unusual_count: dossier.congress_unusual?.length ?? 0,
    institutional_activity_count: dossier.institutional_activity?.length ?? 0,
    predictions_signal_present: dossier.predictions_signal != null,
    catalyst_count: dossier.catalysts?.length ?? 0,
    benzinga_price_target: pt ? { price_target: pt.price_target, firm: pt.firm, action: pt.action } : null,
    fundamental_ratios_present: dossier.fundamental_ratios != null,
    fundamental_signals_present: dossier.fundamental_signals != null,
    sector: dossier.sector ?? null,
  };
}
