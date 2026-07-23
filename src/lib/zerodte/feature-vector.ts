/**
 * 0DTE SETUP FEATURE VECTOR — the row the feature store persists per setup.
 *
 * This is the KEYSTONE the whole intelligence layer reads from. On its own it does nothing; but joined
 * to each setup's graded outcome and accumulated over N sessions, it becomes the single asset that makes
 * these tractable instead of hand-waved:
 *   - Probability engine     — P(win | features), calibrated from the store
 *   - Bayesian likelihoods   — P(feature | win) / P(feature | loss), estimated from the store
 *   - Historical similarity  — k-NN over these vectors ("27 nearest analogs, 74% won")
 *   - Regime-conditional wts  — segment the store by reg_structure and learn per-regime weights
 *   - Kelly sizing           — needs the calibrated probability above
 *
 * `buildSetupFeatureVector` composes the two engines we already shipped — computeFlowQuality (the 0–100
 * flow read + momentum) and classifyRegime ("what kind of day is it") — with the intraday technicals,
 * dealer positioning, and market context into ONE flat, versioned blob. Flat + versioned on purpose:
 * flat so it maps straight to JSONB and to a numeric vector for distance/binning; versioned (`v`) so the
 * schema can evolve without orphaning old graded rows.
 *
 * PURE & deterministic — no IO. The DB column + the write-hook that persists this on every committed
 * setup is a SEPARATE, ledger-touching step (held for explicit go). This slice just defines and builds
 * the vector, unit-tested in isolation.
 *
 * On normalization: the numeric-feature DISTANCE metric (for k-NN) is deliberately NOT here — a correct
 * metric standardizes each feature by its EMPIRICAL mean/std from the accumulated store, which doesn't
 * exist until the store does. Hand-picked global ranges would be a lie. Distance ships with the
 * similarity slice, standardized from real data. This module exposes the key lists + a raw extractor so
 * that slice has exactly what it needs.
 */

import type { FlowQuality } from "./flow-quality";
import type { MarketRegime } from "./regime";

/** Bump when the vector's shape changes so old graded rows stay interpretable. */
export const FEATURE_VECTOR_VERSION = 1;

export interface SetupFeatureInputs {
  ticker: string;
  direction: "long" | "short";
  /** Minutes into the ET session at commit (e.g. 10:30 → 630 − 570 = 60). */
  etMinutes: number;
  /** Board evidence score (post intraday-edge layer — the number the gate stack judges). */
  evidenceScore: number;
  /** Dossier composite score, when the setup was enriched (top-5). */
  dossierScore?: number | null;
  /**
   * From computeFlowQuality(prints). OPTIONAL: it's produced at the aggregation site (board.ts), which
   * a later slice threads through; when absent, all fq_* fields persist as null rather than fabricated.
   */
  flowQuality?: FlowQuality | null;
  /**
   * From classifyRegime(input). OPTIONAL: needs SPY session OHLC that a later slice threads to the
   * persist point; when absent, all reg_* fields persist as null. A null feature is honest; a zero is a lie.
   */
  regime?: MarketRegime | null;
  // ── intraday technicals ──
  vwapDistPct?: number | null;
  orBreak?: "above" | "below" | "inside" | null;
  trend5m?: "up" | "down" | "flat" | null;
  rsi14?: number | null;
  relVolume?: number | null;
  atr14?: number | null;
  // ── dealer positioning ──
  gammaRegime?: string | null;
  /** Distance from spot to the GEX king strike, as a signed % of spot. */
  gexKingDistPct?: number | null;
  darkPoolBias?: "bullish" | "bearish" | "mixed" | null;
  // ── market context ──
  vix?: number | null;
  spyBias?: "up" | "down" | "flat" | null;
  /** Confluence tier at commit. */
  confluence?: "triple" | "double" | "weak" | null;
}

/** The flat, versioned feature row. Numeric where possible; small categorical strings otherwise. */
export interface SetupFeatureVector {
  v: number;
  // identity / context
  ticker: string;
  side: "long" | "short";
  tod_min: number;
  // scores
  evidence_score: number;
  dossier_score: number | null;
  // flow quality (flattened from FlowQuality; null when flowQuality wasn't threaded to this setup yet)
  fq_score: number | null;
  fq_premium_depth: number | null;
  fq_aggression: number | null;
  fq_sweep: number | null;
  fq_persistence: number | null;
  fq_concentration: number | null;
  fq_momentum: number | null;
  fq_institutional: number | null;
  fq_dominance: number | null;
  fq_accelerating: 0 | 1 | null;
  fq_prem_per_min: number | null;
  fq_net_prem_slope: number | null;
  // regime (null when the regime wasn't threaded to the persist point yet)
  reg_structure: string | null;
  reg_gap: string | null;
  reg_vol: string | null;
  reg_opex: 0 | 1 | null;
  reg_quad: 0 | 1 | null;
  reg_fed: 0 | 1 | null;
  // intraday technicals
  vwap_dist_pct: number | null;
  or_break: string | null;
  trend_5m: string | null;
  rsi14: number | null;
  rel_volume: number | null;
  atr14: number | null;
  // positioning
  gamma_regime: string | null;
  gex_king_dist_pct: number | null;
  dark_pool_bias: string | null;
  // market
  vix: number | null;
  spy_bias: string | null;
  confluence: string | null;
}

const numOrNull = (n: number | null | undefined): number | null =>
  n != null && Number.isFinite(n) ? n : null;

/** Compose the two engines + technicals + context into the flat, versioned feature row. */
export function buildSetupFeatureVector(input: SetupFeatureInputs): SetupFeatureVector {
  const fq = input.flowQuality ?? null;
  const reg = input.regime ?? null;
  return {
    v: FEATURE_VECTOR_VERSION,
    ticker: input.ticker.toUpperCase(),
    side: input.direction,
    tod_min: Math.round(input.etMinutes),
    evidence_score: Math.round(input.evidenceScore),
    dossier_score: numOrNull(input.dossierScore),
    // flow quality — null throughout when not yet threaded, never a fabricated 0
    fq_score: fq ? fq.score : null,
    fq_premium_depth: fq ? fq.components.premiumDepth : null,
    fq_aggression: fq ? fq.components.aggression : null,
    fq_sweep: fq ? fq.components.sweepIntensity : null,
    fq_persistence: fq ? fq.components.persistence : null,
    fq_concentration: fq ? fq.components.concentration : null,
    fq_momentum: fq ? fq.components.momentum : null,
    fq_institutional: fq ? fq.components.institutional : null,
    fq_dominance: fq ? fq.dominance : null,
    fq_accelerating: fq ? (fq.momentum.accelerating ? 1 : 0) : null,
    fq_prem_per_min: fq ? fq.momentum.premiumPerMin : null,
    fq_net_prem_slope: fq ? fq.momentum.netPremiumSlopePerMin : null,
    // regime — null throughout when not yet threaded
    reg_structure: reg ? reg.structure : null,
    reg_gap: reg ? reg.gap : null,
    reg_vol: reg ? reg.vol : null,
    reg_opex: reg ? (reg.calendar.opex ? 1 : 0) : null,
    reg_quad: reg ? (reg.calendar.quarterlyOpex ? 1 : 0) : null,
    reg_fed: reg ? (reg.calendar.fedDay ? 1 : 0) : null,
    // intraday technicals
    vwap_dist_pct: numOrNull(input.vwapDistPct),
    or_break: input.orBreak ?? null,
    trend_5m: input.trend5m ?? null,
    rsi14: numOrNull(input.rsi14),
    rel_volume: numOrNull(input.relVolume),
    atr14: numOrNull(input.atr14),
    // positioning
    gamma_regime: input.gammaRegime ?? null,
    gex_king_dist_pct: numOrNull(input.gexKingDistPct),
    dark_pool_bias: input.darkPoolBias ?? null,
    // market
    vix: numOrNull(input.vix),
    spy_bias: input.spyBias ?? null,
    confluence: input.confluence ?? null,
  };
}

/**
 * The numeric feature keys — the columns the probability/similarity layers standardize + compare. Order
 * is stable so a downstream vector is positional. (Distance itself lives in the similarity slice, where
 * these get standardized by their empirical distribution — see the module header.)
 */
export const NUMERIC_FEATURE_KEYS = [
  "tod_min", "evidence_score", "dossier_score",
  "fq_score", "fq_premium_depth", "fq_aggression", "fq_sweep", "fq_persistence",
  "fq_concentration", "fq_momentum", "fq_institutional", "fq_dominance",
  "fq_accelerating", "fq_prem_per_min", "fq_net_prem_slope",
  "reg_opex", "reg_quad", "reg_fed",
  "vwap_dist_pct", "rsi14", "rel_volume", "atr14", "gex_king_dist_pct", "vix",
] as const satisfies ReadonlyArray<keyof SetupFeatureVector>;

/** The categorical feature keys — compared by exact match / one-hot in the downstream layers. */
export const CATEGORICAL_FEATURE_KEYS = [
  "side", "reg_structure", "reg_gap", "reg_vol",
  "or_break", "trend_5m", "gamma_regime", "dark_pool_bias", "spy_bias", "confluence",
] as const satisfies ReadonlyArray<keyof SetupFeatureVector>;

/**
 * Raw numeric sub-vector in NUMERIC_FEATURE_KEYS order. Nulls become `null` entries (not 0) so a downstream
 * standardizer can skip missing features rather than treating them as a real zero.
 */
export function numericVector(v: SetupFeatureVector): Array<number | null> {
  return NUMERIC_FEATURE_KEYS.map((k) => {
    const val = v[k];
    return typeof val === "number" && Number.isFinite(val) ? val : null;
  });
}
