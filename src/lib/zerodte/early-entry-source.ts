// EARLY-ENTRY discovery origin — score mapping + seed->setup bridge.
// The pure half of the early-entry pipeline that actually reaches the live 0DTE board (the IO
// orchestration lives in momentum-signal-discovery.ts, which was rewritten to call this
// pipeline — see that file's header for why the "MOMENTUM" origin tag/plumbing was kept and the
// internals replaced). Mirrors breakout-source.ts/momentum-signal-source.ts's own
// score+bridge shape exactly, so the deck's "Why this play was picked" panel gets the same
// factor_breakdown every other origin already provides.
//
// WHY A SHARPER BAR THAN THE SUB-$1.00 "RUNNER" SCORE (momentum-signal-source.ts): that origin's
// detection gate was momentum-acceleration + RVOL alone. This one requires clearing FOUR
// independent, real checks before a score is even computed — a developing (not already-extended)
// coil, a confirmed price+volume breakout trigger, a liquid $1.00-$3.00 contract, and an
// explicit "most of the move hasn't already happened" test — so the BASE credit here is higher
// (25 vs 20) and the component weights reward room-to-run and tested conviction, not just a bare
// reachability number.

import {
  deriveContractHorizon,
  enrichSetup,
  gradingPolicyForHorizon,
  type EnrichedZeroDteSetup,
  type ZeroDteSetup,
} from "./board";
import { wholeMarketEnabled } from "./breakout-source";
import type { EarlyEntryAlert } from "./early-entry-alert";
import type { EarlyEntryCandidate } from "./early-entry-contract-select";
import type { PressureRead } from "./early-entry-pressure";

/** Per-source switch. ON by default. Set ZERODTE_SRC_MOMENTUM=0 to disable — same env var the
 *  prior sub-$1.00 implementation used; this is a replacement of that pipeline's internals, not
 *  a second origin, so the operator's existing on/off switch keeps working unchanged. */
export function earlyEntrySrcFlagEnabled(): boolean {
  return process.env.ZERODTE_SRC_MOMENTUM !== "0";
}
export function earlyEntrySourceEnabled(): boolean {
  return wholeMarketEnabled() && earlyEntrySrcFlagEnabled();
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

export const EARLY_ENTRY_SCORE_BASE = 25;
export const EARLY_ENTRY_REACHABILITY_MAX = 30;
export const EARLY_ENTRY_ROOM_TO_RUN_MAX = 20;
export const EARLY_ENTRY_SPREAD_MAX = 15;
export const EARLY_ENTRY_LEVEL_TESTS_MAX = 10;
/** Spread-quality clip, matching breakout-source.ts's own convention. */
export const EARLY_ENTRY_SPREAD_QUALITY_CLIP_PCT = 50;
/** Level-test count that saturates the conviction factor (more tests = more real conviction,
 *  but a 10th test isn't materially more informative than a 5th). */
export const EARLY_ENTRY_LEVEL_TESTS_FULL = 5;

function reachabilityFactor(candidate: Pick<EarlyEntryCandidate, "reachability_prob">): number {
  return candidate.reachability_prob ?? 0;
}
function roomToRunFactor(candidate: Pick<EarlyEntryCandidate, "captured_fraction">): number {
  // captured_fraction can be negative (more room than at watch-detection) -- clamp only the TOP,
  // never discard the extra credit a genuine retrace earns.
  return 1 - clamp01(candidate.captured_fraction ?? 0);
}
function spreadFactor(candidate: Pick<EarlyEntryCandidate, "spread_pct">): number {
  if (candidate.spread_pct == null) return 0;
  return clamp01(1 - candidate.spread_pct / EARLY_ENTRY_SPREAD_QUALITY_CLIP_PCT);
}
function levelTestsFactor(pressure: Pick<PressureRead, "level_tests"> | null): number {
  if (!pressure) return 0;
  return clamp01(pressure.level_tests / EARLY_ENTRY_LEVEL_TESTS_FULL);
}

/** Pure + deterministic. See this file's header for why the component weights differ from the
 *  prior sub-$1.00 origin's score. */
export function earlyEntryScore(
  candidate: Pick<EarlyEntryCandidate, "reachability_prob" | "captured_fraction" | "spread_pct">,
  pressure: Pick<PressureRead, "level_tests"> | null
): number {
  const raw =
    EARLY_ENTRY_SCORE_BASE +
    reachabilityFactor(candidate) * EARLY_ENTRY_REACHABILITY_MAX +
    roomToRunFactor(candidate) * EARLY_ENTRY_ROOM_TO_RUN_MAX +
    spreadFactor(candidate) * EARLY_ENTRY_SPREAD_MAX +
    levelTestsFactor(pressure) * EARLY_ENTRY_LEVEL_TESTS_MAX;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/** The SAME score, decomposed into points — feeds `factor_breakdown` on the deck. */
export function earlyEntryScoreBreakdown(
  candidate: Pick<EarlyEntryCandidate, "reachability_prob" | "captured_fraction" | "spread_pct">,
  pressure: Pick<PressureRead, "level_tests"> | null
): { score: number; factors: Record<string, number> } {
  const score = earlyEntryScore(candidate, pressure);
  const reachPts = Math.round(reachabilityFactor(candidate) * EARLY_ENTRY_REACHABILITY_MAX);
  const roomPts = Math.round(roomToRunFactor(candidate) * EARLY_ENTRY_ROOM_TO_RUN_MAX);
  const spreadPts = Math.round(spreadFactor(candidate) * EARLY_ENTRY_SPREAD_MAX);
  const testsPts = Math.round(levelTestsFactor(pressure) * EARLY_ENTRY_LEVEL_TESTS_MAX);
  const basePts = score - reachPts - roomPts - spreadPts - testsPts;
  return {
    score,
    factors: {
      strike_reachability: reachPts,
      room_to_run: roomPts,
      spread_quality: spreadPts,
      level_test_conviction: testsPts,
      screen_base: basePts,
    },
  };
}

/**
 * Build an EnrichedZeroDteSetup from a real ENTRY-state alert. discovery_origin stays
 * ["MOMENTUM"] (the already-audited origin tag/plumbing — board.ts's DiscoveryOrigin union,
 * DISCOVERY_ORIGIN_ORDER, discovery-health.ts's MOMENTUM lane, why-now.ts's "momentum" reason —
 * all already correct for this origin and unchanged by this pipeline swap). Always dte=0/
 * ZERO_DTE: the operator's spec is same-day-expiration only, same as the prior implementation.
 */
export function buildEarlyEntrySetup(input: {
  alert: EarlyEntryAlert;
  candidate: EarlyEntryCandidate;
  pressure: PressureRead | null;
  todayYmd: string;
  spotAsOf?: string | null;
}): EnrichedZeroDteSetup {
  const { alert, candidate, pressure } = input;
  const { score, factors: scoreFactors } = earlyEntryScoreBreakdown(candidate, pressure);
  const spot = alert.underlying_spot_now;
  const otmPct =
    spot > 0
      ? Math.round(
          ((alert.direction === "long" ? candidate.strike - spot : spot - candidate.strike) / spot) * 100 * 100
        ) / 100
      : null;
  const base: ZeroDteSetup = {
    ticker: alert.ticker.toUpperCase(),
    direction: alert.direction,
    play_type: "DIRECTIONAL",
    discovery_origin: ["MOMENTUM"],
    top_strike: candidate.strike,
    top_strike_avg_fill: null,
    expiry: input.todayYmd,
    dte: 0,
    contract_horizon: deriveContractHorizon(0),
    actual_dte_at_commit: 0,
    grading_policy: gradingPolicyForHorizon(deriveContractHorizon(0)),
    net_premium: 0,
    gross_premium: 0,
    prints: 0,
    sweep_pct: 0,
    side_dominance: 0.5,
    underlying_price: Math.round(spot * 100) / 100,
    underlying_price_as_of: input.spotAsOf ?? null,
    underlying_price_source: "chain_spot",
    score,
    aggression: null,
    otm_pct: otmPct,
    new_money: false,
    recent_premium_30m: 0,
    spike: false,
    first_seen: null,
    last_seen: null,
    flow_quality: null,
    // The confirmed breakout's own recent-window move (pressure.compression's recent range is the
    // coil, not the breakout itself) -- distance_to_level_pct at trigger time is the best honest
    // proxy available for "how far this already moved," matching the sub-$1.00 origin's own
    // documented convention of using a real, already-computed signal field here, never a fabricated
    // day-level change%.
    change_pct: pressure?.distance_to_level_pct != null ? Math.round(Math.abs(pressure.distance_to_level_pct) * 100) / 100 : null,
  };
  return {
    ...enrichSetup(base, null),
    factor_breakdown: scoreFactors,
  };
}
