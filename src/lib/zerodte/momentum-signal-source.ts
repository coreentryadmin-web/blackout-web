// ── MOMENTUM discovery origin (operator directive, 2026-10-25) ───────────────────────────
// The 4th INDEPENDENT discovery source that feeds the ONE live 0DTE board (after FLOW,
// BREAKOUT, PIN). The operator's own words: "Find same-day expiration calls and puts with an
// executable ask below $1.00 and strong momentum, volatility, volume, liquidity, and a
// realistic path toward the strike. The objective is to identify potential runners from under
// $1.00 toward $20.00 early." Screens a FIXED, small ticker universe (ticker-universe.ts — Mag
// 7 + SPX/SPY/QQQ) for a same-day contract that is both momentum/volume-confirmed on the
// underlying AND price/liquidity realistic right now — no options-flow print (FLOW) and no
// whole-market breadth screen (BREAKOUT) required. Emits its own candidates carrying
// discovery_origin ["MOMENTUM"]; they merge with flow/breakout/pin candidates BY TICKER via the
// SAME `mergeDiscoveryOrigins` (breakout-source.ts) every other origin uses — the merge is
// origin-agnostic, so no new merge function was needed.
//
// This module is PURE (no IO): the score mapping and the seed→setup bridge. The IO
// orchestration (fetch today's minute bars + same-day chain + RVOL per universe ticker) lives
// in momentum-signal-discovery.ts, dynamic-imported from scan.ts only when the source is
// flag-enabled — same discipline as breakout-discovery.ts / pin-discovery.ts.
//
// NOT NAMED "RUNNER": `RUNNER_SETUP_MAX_OTM_PCT` (board.ts) already names an unrelated existing
// concept (a Vector-corroborated far-OTM cap) — reusing that word for this origin would read as
// the same thing under two different meanings. "MOMENTUM" is the origin tag everywhere else in
// this codebase (momentum-signal.ts, momentum-acceleration.ts).
//
// FLAG-GATED ON by default (set either to "0" to disable): ZERODTE_WHOLE_MARKET (master, shared
// with BREAKOUT/PIN) AND ZERODTE_SRC_MOMENTUM (per-source).

import {
  deriveContractHorizon,
  enrichSetup,
  gradingPolicyForHorizon,
  type EnrichedZeroDteSetup,
  type ZeroDteSetup,
} from "./board";
import { wholeMarketEnabled } from "./breakout-source";
import type { MomentumSignalCandidate } from "./momentum-signal";
import type { MomentumAccelerationRead } from "./momentum-acceleration";

/** Per-source MOMENTUM switch. ON by default. Set ZERODTE_SRC_MOMENTUM=0 to disable. */
export function momentumSrcFlagEnabled(): boolean {
  return process.env.ZERODTE_SRC_MOMENTUM !== "0";
}
/** The MOMENTUM source runs only when BOTH the shared whole-market master and the per-source
 *  flag are on — same master switch BREAKOUT/PIN read, so one flag can kill every non-FLOW
 *  origin at once if ops needs to. */
export function momentumSourceEnabled(): boolean {
  return wholeMarketEnabled() && momentumSrcFlagEnabled();
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

// ── Score mapping (0–100, the SAME scale FLOW/BREAKOUT/PIN use — G-3's 65 floor judges all) ──
// Four independently-capped components, summing to 100 at full strength, matching the
// BASE + weighted-components shape breakout-source.ts/pin-source.ts already use:
//   momentum_core:  how large the confirmed recent move is (saturates at MOMENTUM_MOVE_FULL %)
//   rvol:           how far above the detection floor the relative-volume ratio sits
//   reachability:   rankContractsByReachability's own touch-probability proxy for THIS strike
//   spread_quality: tighter quoted spread = more of the displayed entry is actually executable
// BASE credits clearing the detection gate itself (momentum confirmed + RVOL floor, both already
// required for `evaluateMomentumSignal` to emit any candidate at all) — not a free pass, since a
// weak reachability/spread read still collapses the other three components toward 0.
export const MOMENTUM_SCORE_BASE = 20;
export const MOMENTUM_MOVE_FULL = 0.75; // % recent-window move that saturates the momentum factor
export const MOMENTUM_CORE_MAX = 25;
export const MOMENTUM_RVOL_MAX = 20;
export const MOMENTUM_RVOL_FULL_RATIO = 4; // RVOL ratio that saturates the rvol factor
export const MOMENTUM_REACHABILITY_MAX = 25;
export const MOMENTUM_SPREAD_MAX = 10;
/** Spread-quality clip, matching breakout-source.ts's SPREAD_QUALITY_CLIP_PCT convention — a
 *  quoted spread at/above this % of mid earns zero spread credit. */
export const MOMENTUM_SPREAD_QUALITY_CLIP_PCT = 50;

function momentumMoveFactor(momentum: MomentumAccelerationRead): number {
  const move = momentum.recent_move_pct;
  if (move == null) return 0;
  return clamp01(Math.abs(move) / MOMENTUM_MOVE_FULL);
}

function rvolFactor(rvolRatio: number | null): number {
  if (rvolRatio == null) return 0;
  return clamp01((rvolRatio - 1) / (MOMENTUM_RVOL_FULL_RATIO - 1));
}

function reachabilityFactor(candidate: Pick<MomentumSignalCandidate, "reachability_prob">): number {
  return candidate.reachability_prob ?? 0; // null (no real iv) -> no fabricated credit
}

function spreadFactor(candidate: Pick<MomentumSignalCandidate, "spread_pct">): number {
  if (candidate.spread_pct == null) return 0; // unknown spread -> no fabricated credit
  return clamp01(1 - candidate.spread_pct / MOMENTUM_SPREAD_QUALITY_CLIP_PCT);
}

/**
 * Map one MOMENTUM candidate to a 0-100 board score. Pure + deterministic. See the component
 * doc above for what each factor measures and why it's capped the way it is.
 */
export function momentumScore(
  candidate: Pick<MomentumSignalCandidate, "reachability_prob" | "spread_pct">,
  momentum: MomentumAccelerationRead,
  rvolRatio: number | null
): number {
  const core = momentumMoveFactor(momentum) * MOMENTUM_CORE_MAX;
  const rvol = rvolFactor(rvolRatio) * MOMENTUM_RVOL_MAX;
  const reach = reachabilityFactor(candidate) * MOMENTUM_REACHABILITY_MAX;
  const spread = spreadFactor(candidate) * MOMENTUM_SPREAD_MAX;
  const raw = MOMENTUM_SCORE_BASE + core + rvol + reach + spread;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/**
 * The SAME score, decomposed into the points each component contributed — so the deck's "Why
 * this play was picked" panel can render factor_breakdown for a MOMENTUM setup exactly like it
 * already does for FLOW/BREAKOUT/PIN (see breakoutScoreBreakdown's own header for why this
 * matters: a BREAKOUT setup with no breakdown once read as "component breakdown not served for
 * this lane yet" on a live board). Rounding remainder folds into the base so parts always sum to
 * the displayed score.
 */
export function momentumScoreBreakdown(
  candidate: Pick<MomentumSignalCandidate, "reachability_prob" | "spread_pct">,
  momentum: MomentumAccelerationRead,
  rvolRatio: number | null
): { score: number; factors: Record<string, number> } {
  const score = momentumScore(candidate, momentum, rvolRatio);
  const corePts = Math.round(momentumMoveFactor(momentum) * MOMENTUM_CORE_MAX);
  const rvolPts = Math.round(rvolFactor(rvolRatio) * MOMENTUM_RVOL_MAX);
  const reachPts = Math.round(reachabilityFactor(candidate) * MOMENTUM_REACHABILITY_MAX);
  const spreadPts = Math.round(spreadFactor(candidate) * MOMENTUM_SPREAD_MAX);
  const basePts = score - corePts - rvolPts - reachPts - spreadPts;
  return {
    score,
    factors: {
      momentum_core: corePts,
      relative_volume: rvolPts,
      strike_reachability: reachPts,
      spread_quality: spreadPts,
      screen_base: basePts,
    },
  };
}

// ── Seed→setup bridge ───────────────────────────────────────────────────────────────

/**
 * Build an EnrichedZeroDteSetup-shaped candidate for one MOMENTUM candidate contract.
 * discovery_origin is ["MOMENTUM"]; expiry is ALWAYS `todayYmd` (dte=0) — the operator's spec is
 * explicitly same-day-expiration only, and momentum-signal.ts's chain screen already filters to
 * today's expiry before a candidate ever reaches this bridge (see momentum-signal-discovery.ts).
 * Flow-only fields are set to HONEST nulls/neutral (never fabricated) — same convention as
 * buildBreakoutSetup. The setup runs through enrichSetup(., null) so it carries the full
 * enriched shape, then the scan's shared attachContractPlans/attachIntradayEdge/
 * attachConfluence/attachGateVerdicts run on it unchanged, exactly like every other origin.
 */
export function buildMomentumSetup(input: {
  ticker: string;
  candidate: MomentumSignalCandidate;
  momentum: MomentumAccelerationRead;
  rvolRatio: number | null;
  spot: number;
  todayYmd: string;
  /** ISO-8601 observation time of `spot`, when the caller knows it. Omitted -> null (never
   *  fabricated) — attachContractPlans re-stamps it off the batched live option snapshot anyway. */
  spotAsOf?: string | null;
}): EnrichedZeroDteSetup {
  const { ticker, candidate, momentum, rvolRatio, spot, todayYmd } = input;
  const { score, factors: scoreFactors } = momentumScoreBreakdown(candidate, momentum, rvolRatio);
  const direction = candidate.direction;
  const otmPct =
    spot > 0
      ? Math.round(
          ((direction === "long" ? candidate.strike - spot : spot - candidate.strike) / spot) * 100 * 100
        ) / 100
      : null;
  const base: ZeroDteSetup = {
    ticker: ticker.toUpperCase(),
    direction,
    play_type: "DIRECTIONAL",
    discovery_origin: ["MOMENTUM"],
    top_strike: candidate.strike,
    top_strike_avg_fill: null, // no flow fill -- attachContractPlans prices off the live mark
    expiry: todayYmd,
    dte: 0,
    contract_horizon: deriveContractHorizon(0), // always ZERO_DTE -- the spec is same-day-only
    actual_dte_at_commit: 0,
    grading_policy: gradingPolicyForHorizon(deriveContractHorizon(0)),
    net_premium: 0, // no directional option premium -- this is a price/volume+chain screen
    gross_premium: 0,
    prints: 0,
    sweep_pct: 0,
    side_dominance: 0.5, // neutral: no option-flow side to be dominant (flow gates are SKIPPED here)
    underlying_price: Math.round(spot * 100) / 100,
    underlying_price_as_of: input.spotAsOf ?? null,
    underlying_price_source: "chain_spot",
    score,
    aggression: null, // honest null -- there is no tape aggression for a bare momentum candidate
    otm_pct: otmPct,
    new_money: false,
    recent_premium_30m: 0,
    spike: false,
    first_seen: null,
    last_seen: null,
    flow_quality: null,
    // The confirmed RECENT-WINDOW move (momentum-acceleration.ts's 5m-by-default window), not a
    // full-session day change -- the best honest proxy available for this origin, same spirit as
    // breakout-source.ts's own change_pct note (feeds the MOMENTUM rail's third real input).
    change_pct: Math.round(Math.abs(momentum.recent_move_pct ?? 0) * 100) / 100,
  };
  // enrichSetup with a null dossier fills the enriched fields (condor from spot, technicals
  // null, gate/cortex/plan null) exactly as every other dossier-less origin does.
  return {
    ...enrichSetup(base, null),
    factor_breakdown: scoreFactors,
  };
}
