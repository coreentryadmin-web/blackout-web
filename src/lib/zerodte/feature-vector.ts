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
import { discoveryOriginLabel, type ContractHorizon, type DiscoveryOrigin } from "./board";
import type { ScoredCandidate } from "@/features/nighthawk/lib/scorer";

/** Bump when the vector's shape changes so old graded rows stay interpretable. */
export const FEATURE_VECTOR_VERSION = 1;

/**
 * NH-R2 — STRUCTURED SCORE ATTRIBUTION (one entry per named scoring dimension, "which factor
 * contributed how many points"). `ScoredCandidate` (nighthawk/scorer.ts) already carries these as
 * individual named sub-score fields — this is a pure re-shape into a queryable list, not a new
 * scoring computation. Mirrors the compose.ts narrative convention (a labeled, signed-weight list
 * per source) but STRUCTURED instead of a human-readable string, so it can be joined/aggregated
 * later without re-parsing prose.
 */
export interface AttributionEntry {
  /** Stable factor label (snake_case), one per named ScoredCandidate sub-score. */
  factor: string;
  /** The sub-score's point contribution, verbatim (already signed where the source is signed). */
  points: number;
  /** Sign of `points` — "neutral" for exactly 0, never inferred beyond that. */
  direction: "up" | "down" | "neutral";
}

function attributionDirection(points: number): "up" | "down" | "neutral" {
  if (points > 0) return "up";
  if (points < 0) return "down";
  return "neutral";
}

/**
 * Map a scored candidate's named sub-scores onto a structured, per-factor attribution list.
 *
 * Pure, deterministic, no IO. Order mirrors ScoredCandidate's field declaration order.
 *
 * Two disjoint rules (documented on purpose, mirrors the null-vs-zero discipline the rest of this
 * module already follows):
 *   - REQUIRED dimensions (flow/tech/pos/news/smart_money) are ALWAYS emitted, even at exactly 0 —
 *     every candidate computes all five, so a real 0 is honest evidence ("nothing on this axis"),
 *     not a missing read. Omitting them would make "no signal" indistinguishable from "not computed".
 *   - OPTIONAL dimensions (fundamental/catalyst/short_interest/wall_proximity/vex_alignment/skew/
 *     the governor penalty) are OMITTED when `undefined` (this candidate never ran that scorer leg —
 *     an honest "no read" is silence, not a fabricated 0-point entry) and included, marked neutral,
 *     when present as an actual 0.
 */
export function buildScoreAttribution(scored: ScoredCandidate): AttributionEntry[] {
  const entries: AttributionEntry[] = [];

  const required: Array<[string, number]> = [
    ["flow", scored.flow_score],
    ["technicals", scored.tech_score],
    ["positioning", scored.pos_score],
    ["news", scored.news_score],
    ["smart_money", scored.smart_money_score],
  ];
  for (const [factor, points] of required) {
    entries.push({ factor, points, direction: attributionDirection(points) });
  }

  const optional: Array<[string, number | undefined]> = [
    ["fundamental", scored.fundamental_score],
    ["catalyst", scored.catalyst_score],
    ["short_interest", scored.short_interest_score],
    ["wall_proximity", scored.wall_proximity_score],
    ["vex_alignment", scored.vex_alignment_score],
    ["skew", scored.skew_score],
  ];
  for (const [factor, points] of optional) {
    if (points === undefined) continue; // that scorer leg never ran for this candidate — silence, not a 0
    entries.push({ factor, points, direction: attributionDirection(points) });
  }

  // The cross-edition governor SUBTRACTS points (govPenalty is a positive magnitude removed from the
  // total), so its attributed contribution is negative — flip the sign so "down" reads consistently
  // with every other entry (points < 0 == this factor pulled the total down).
  if (scored.govPenalty !== undefined) {
    const points = -scored.govPenalty;
    entries.push({ factor: "governor_penalty", points, direction: attributionDirection(points) });
  }

  return entries;
}

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
  /** Discovery provenance SET at commit (Phase 3a) — which independent source(s) surfaced this
   *  setup. Flattened to a canonical label (FLOW / BREAKOUT / FLOW+BREAKOUT) in the vector so the
   *  intelligence layer can slice/one-hot by origin. Absent → persists as null (never fabricated). */
  discoveryOrigin?: DiscoveryOrigin[] | null;
  /** Contract HORIZON at commit (PR-1 horizon integrity): ZERO_DTE / ONE_DTE (a WEEKLY_FALLBACK is
   *  excluded before commit, so it never reaches the feature store — keeping the 0DTE population
   *  structurally homogeneous for the per-horizon calibration versioning later). Absent → null. */
  contractHorizon?: ContractHorizon | null;
  /** The REAL dte of the selected contract at commit (0 or 1 for a committed row). Absent → null. */
  actualDteAtCommit?: number | null;
  /** Frozen strategy config hash at commit (strategy-version.ts, design Q12). Stamped so the feature
   *  store can partition its own population by strategy version exactly as the calibration analyzer
   *  does — a scorer/gate/exit/grader change bumps the hash, and old vectors stay in their own cohort
   *  instead of being blended with plays a changed strategy would have produced differently. Threaded
   *  from the commit site (scan.ts); absent → null (an honest "unversioned" read, never fabricated). */
  strategyConfigHash?: string | null;
  /** WS-06: which discovery rail OWNED the kept direction at merge (FLOW under v1 precedence). The
   *  full per-rail direction/score maps live in entry_context.origin_maps; the owner is flattened
   *  here so the store can one-hot/slice by it. Absent → null (never fabricated). */
  directionOwner?: DiscoveryOrigin | null;
  /** WS-06: the merge/precedence version the origin maps were frozen under (MERGE_POLICY_VERSION).
   *  Absent → null. */
  mergePolicyVersion?: string | null;
  /** NH-R2: the nighthawk-scorer candidate this setup came from, when the commit site has one — used
   *  ONLY to derive `attribution` (buildScoreAttribution), never read for any other field on this row.
   *  Absent → `attribution: []` (an honest "not threaded" empty list, never fabricated entries). */
  scored?: ScoredCandidate | null;
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
  /** Canonical discovery-origin label (FLOW / BREAKOUT / FLOW+BREAKOUT); null when not threaded. */
  discovery_origin: string | null;
  /** Contract horizon at commit (ZERO_DTE / ONE_DTE). null when not threaded. Persisted so the
   *  feature store can prove/slice its own same-day homogeneity (only these two values ever appear). */
  contract_horizon: string | null;
  /** Real selected-contract dte at commit (0 or 1 for a committed row). null when not threaded. */
  actual_dte_at_commit: number | null;
  /** Frozen strategy config hash at commit (design Q12). null when not threaded → an "unversioned"
   *  row the calibration analyzer keeps in its own cohort, never blended with the current hash. */
  strategy_config_hash: string | null;
  /** WS-06: discovery rail that owned the kept direction (FLOW / BREAKOUT / PIN). null when not threaded. */
  direction_owner: string | null;
  /** WS-06: merge/precedence version the origin maps were frozen under. null when not threaded. */
  merge_policy_version: string | null;
  /** NH-R2: structured per-factor score breakdown (buildScoreAttribution), one entry per named
   *  ScoredCandidate sub-score that ran for this setup. [] when no scored candidate was threaded to
   *  this commit — never fabricated entries. Purely additive: nothing reads this field today (see
   *  docs/audit/NIGHTHAWK-DATA-PROVENANCE.md §7-G), it rides the same unconsumed keystone row. */
  attribution: AttributionEntry[];
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
    // Canonical origin label; null (not "no_origin") when the origin wasn't threaded, so a missing
    // read is honest rather than reading like a real "no origin" bucket in the store.
    discovery_origin:
      input.discoveryOrigin && input.discoveryOrigin.length > 0
        ? discoveryOriginLabel(input.discoveryOrigin)
        : null,
    // Contract horizon at commit (PR-1). Only ZERO_DTE/ONE_DTE ever appear (weekly fallbacks are
    // excluded before commit) — null (not a fabricated value) when the horizon wasn't threaded.
    contract_horizon: input.contractHorizon ?? null,
    actual_dte_at_commit: numOrNull(input.actualDteAtCommit),
    // Strategy config hash at commit (design Q12). null (not a fabricated value) when the hash wasn't
    // threaded — the calibration analyzer cohorts a null-hash row as "unversioned", never as current.
    strategy_config_hash: input.strategyConfigHash ?? null,
    // WS-06 origin provenance (the full maps live in entry_context.origin_maps; these two are the
    // flat slice-able keys). null (not fabricated) when not threaded.
    direction_owner: input.directionOwner ?? null,
    merge_policy_version: input.mergePolicyVersion ?? null,
    // NH-R2: [] (not null) when no scored candidate was threaded — an empty list is the honest
    // "nothing to attribute yet" read, consistent with how the sibling swing vector defaults its own
    // capture-only array fields (`secondary: []`) rather than null.
    attribution: input.scored ? buildScoreAttribution(input.scored) : [],
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
  "discovery_origin",
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
