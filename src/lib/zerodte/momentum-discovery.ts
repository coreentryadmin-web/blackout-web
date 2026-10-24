// SHADOW-ONLY combiner — ties momentum-acceleration.ts + relative-volume + strike-reachability.ts
// into ONE candidate read: "is there a real, independently-detectable setup here, right now,
// and if so which available contracts could realistically reach their strike." No caller in the
// live board/scan/cortex/commit path imports this file — same unwired-shadow-signal discipline
// as every other module in this directory (see relative-volume.ts's header for the full
// rationale on why a brand-new, uncalibrated signal stays out of the real-money commit path
// until it has real paired-outcome data behind it).
//
// WHY THIS EXISTS (2026-10-22, operator directive, "catch bangers like Swift" continuation):
// Night Hawk's two live discovery origins are both DEPENDENT on an external trigger — FLOW needs
// a real UW options-flow alert, BREAKOUT needs a real Polygon grouped-daily (equity-only) gain/
// volume screen hit. Neither one can ever fire for a product UW never alerts on that day (the
// XSP DISCOVERY_MISS finding this round) or an index/ETF underlying BREAKOUT structurally can't
// screen (no "shares traded" the way an equity has). This module is the missing THIRD path: it
// detects a setup directly from the underlying's OWN price/volume action — no UW alert and no
// equity gain screen required — then ranks whatever contracts are actually available against it.
//
// DETECTION GATE (deliberately conservative — two independent confirmations, not one): a setup is
// `detected` only when BOTH (a) `momentum-acceleration.ts` reports `confirmed: true` (an
// accelerating price move AND a genuine key-level break, same direction) AND (b) relative volume
// clears `rvolFloor` (default RVOL_HIGH from relative-volume.ts, i.e. real volume behind the
// move, not a low-volume drift). Momentum alone, or volume alone, is explicitly NOT enough —
// this mirrors the existing live engine's own "multiple independent evidence sources" philosophy
// (FLOW's own min_gross/min_aggr_share/min_dominance stack) rather than inventing a looser bar.
// A null/unavailable RVOL read never auto-passes OR auto-fails by assumption — it correctly
// reports `detected: false` because the volume-confirmation requirement cannot be verified, which
// is the honest "cannot confirm" answer, not a guess in either direction.

import { computeMomentumAcceleration, type MomentumBar, type MomentumAccelerationRead } from "./momentum-acceleration";
import { rankContractsByReachability, type ChainCandidate, type ReachabilityRanked } from "./strike-reachability";
import { RVOL_HIGH } from "./relative-volume";

export type MomentumDiscoveryCandidate = {
  detected: boolean;
  direction: "long" | "short" | null;
  momentum: MomentumAccelerationRead;
  rvol_ratio: number | null;
  rvol_floor_used: number;
  /** Empty when `detected` is false — this module never ranks contracts for a setup it did not
   *  actually detect (no speculative "here's what it would look like" output). */
  ranked_contracts: ReachabilityRanked[];
};

/**
 * Pure. Combines a real momentum-acceleration read (direction confirmed against a caller-supplied
 * key level), a real RVOL ratio (computed elsewhere, e.g. relative-volume.ts/-source.ts — this
 * function does not fetch or compute it), and a real option chain snapshot into one candidate
 * read. Never fabricates a contract ranking for a setup it has not independently confirmed.
 */
export function evaluateMomentumDiscoveryCandidate(input: {
  bars: MomentumBar[];
  referenceLevel?: { high: number; low: number } | null;
  rvolRatio: number | null;
  rvolFloor?: number;
  recentWindowMin?: number;
  priorWindowMin?: number;
  minMovePct?: number;
  minutesRemaining: number;
  candidates: ChainCandidate[];
  minOi?: number;
  maxSpreadPct?: number;
}): MomentumDiscoveryCandidate {
  const rvolFloor = input.rvolFloor ?? RVOL_HIGH;

  const momentum = computeMomentumAcceleration({
    bars: input.bars,
    recentWindowMin: input.recentWindowMin,
    priorWindowMin: input.priorWindowMin,
    minMovePct: input.minMovePct,
    referenceLevel: input.referenceLevel,
  });

  const rvolConfirmed = input.rvolRatio != null && input.rvolRatio >= rvolFloor;
  const detected = momentum.confirmed && rvolConfirmed;
  const direction: "long" | "short" | null = detected
    ? momentum.direction === "up"
      ? "long"
      : "short"
    : null;

  const rankedContracts =
    detected && direction
      ? rankContractsByReachability({
          spot: lastClose(input.bars),
          direction,
          minutesRemaining: input.minutesRemaining,
          candidates: input.candidates,
          minOi: input.minOi,
          maxSpreadPct: input.maxSpreadPct,
        })
      : [];

  return {
    detected,
    direction,
    momentum,
    rvol_ratio: input.rvolRatio,
    rvol_floor_used: rvolFloor,
    ranked_contracts: rankedContracts,
  };
}

function lastClose(bars: MomentumBar[]): number {
  const sorted = [...bars].filter((b) => Number.isFinite(b.t)).sort((a, b) => a.t - b.t);
  return sorted.length ? sorted[sorted.length - 1]!.c : 0;
}
