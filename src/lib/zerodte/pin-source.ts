// ── PIN discovery origin (Phase 3b, docs/audit/0DTE-UNIFICATION-DESIGN.md §1a + §1c) ──
// The THIRD INDEPENDENT whole-market discovery source feeding the ONE live 0DTE board (after
// FLOW and the Phase-3a BREAKOUT source). The board is momentum-only by construction — G-1
// hard-blocks every counter-tape direction, so a name PINNED between dealer GEX walls in a
// long-gamma tape (where dealers dampen the move and price mean-reverts toward the pin) is
// structurally invisible to it. This source screens a LIQUID universe for that range/fade setup
// and emits its own candidates carrying discovery_origin ["PIN"], expressed in the EXISTING
// directional-setup shape as a FADE toward the pin: spot pinned near the PUT wall → long/call
// bias UP toward the pin; near the CALL wall → short/put bias DOWN toward the pin. They merge
// with the flow + breakout candidates BY TICKER (origin preserved as a SET, e.g. ["FLOW","PIN"])
// and run the SAME contract-attach + hard-gate stack + Cortex as every other candidate.
//
// The condor SELL play-type on these same long-gamma names is a SEPARATE Phase 4 — this module
// builds ONLY the PIN directional-fade discovery origin, never a condor.
//
// This module is PURE (no IO): the regime evaluation (is this a genuine dealer-defended pin?),
// the pin-strength → 0–100 score, the ATM contract picker (call OR put by fade side), and the
// seed→setup bridge. The IO orchestration (fetch the per-ticker GEX heatmap + chain) lives in
// pin-discovery.ts, dynamic-imported only when the source is flag-enabled — so the flow-only
// board never loads the whole-universe GEX/provider graph.
//
// FLAG-GATED ON by default (set either to "0" to disable): ZERODTE_WHOLE_MARKET (master, shared with
// the breakout source) AND ZERODTE_SRC_PIN (per-source). When either is off, the board behaves
// EXACTLY as today.

import { ZERODTE_MAX_DTE } from "@/lib/horizons";
import {
  calendarDteBetween,
  deriveContractHorizon,
  enrichSetup,
  gradingPolicyForHorizon,
  mergeSameTickerDiscovery,
  tradingSessionGapDays,
  type DiscoveryOrigin,
  type EnrichedZeroDteSetup,
  type ZeroDteSetup,
} from "./board";

// ── Flags (read at call time so tests can toggle process.env per case) ──────────────
// Default ON: the three discovery systems are production-ready and must survive ECS
// task-definition updates that don't carry env vars. Set to "0" to disable.
/** Master whole-market switch (shared with the breakout source). ON by default. Set ZERODTE_WHOLE_MARKET=0 to disable. */
export function wholeMarketEnabled(): boolean {
  return process.env.ZERODTE_WHOLE_MARKET !== "0";
}
/** Per-source PIN switch. ON by default. Set ZERODTE_SRC_PIN=0 to disable. */
export function pinSrcFlagEnabled(): boolean {
  return process.env.ZERODTE_SRC_PIN !== "0";
}
/** The pin source runs only when BOTH the master and the per-source flag are on. */
export function pinSourceEnabled(): boolean {
  return wholeMarketEnabled() && pinSrcFlagEnabled();
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

// ── Regime evaluation: is this a GENUINE dealer-defended, long-gamma, spot-mid-range pin? ──
// The gate that keeps the whole source honest AND keeps G-1 (tape-alignment) naturally satisfied
// (see the G-1 note at the bottom of this file). We emit a PIN candidate ONLY when ALL hold:
//   1. gamma_posture === "long"  — dealers are net-long gamma, so they hedge AGAINST the move
//      (buy dips / sell rips) → the tape mean-reverts. Without this there is no pin, only trend.
//   2. put_wall < spot < call_wall — spot is genuinely BRACKETED between a dominant call wall
//      above (resistance) and a dominant put wall below (support). One-sided walls are not a
//      bracket and produce no fade.
//   3. the band width (call_wall − put_wall)/spot sits in [MIN, MAX]% — wide enough to be a real
//      range dealers can defend, narrow enough that the move is actually CONTAINED (a 10%-wide
//      "range" is not a pin, it is two unrelated strikes).
//   4. BOTH walls clear a minimum share of ladder |gamma| (dominance) — a bracket needs two REAL
//      defended nodes, not the largest of a flat one-sided ladder.
//   5. spot sits OFF-CENTER toward one wall by a bounded offset — there must be room to revert
//      toward the pin (a dead-center spot has no directional edge; that is the Phase-4 CONDOR
//      case, not a directional fade), but spot must NOT be hugging a wall (about to break out).
// The pin/target is the geometric MIDPOINT of the defended band — the center dealers pin toward.
// (flip and max_pain are alternative pin anchors left for Phase-4 calibration; the band midpoint
// is the cleanest deterministic center that also fixes the fade direction.)

/** Both walls must carry at least this share (%) of ladder |gamma| to count as a defended bracket. */
export const PIN_WALL_MIN_DOM_PCT = 4;
/** Band narrower than this (%) is degenerate (walls basically on top of spot) — not a range. */
export const PIN_BAND_MIN_PCT = 0.4;
/** Band wider than this (%) is not a dealer-CONTAINED pin — the move isn't defended edge-to-edge. */
export const PIN_BAND_MAX_PCT = 6;
/** Spot must be at least this far off the band center (fraction of half-width) to have a fade edge. */
export const PIN_MIN_OFFSET = 0.25;
/** Spot closer than this to a wall (fraction of half-width from center) is breakout-risk, not a pin. */
export const PIN_MAX_OFFSET = 0.9;

/** Inputs to the pure regime read — all already derived by pin-discovery.ts from the GEX heatmap
 *  via the reused gamma math (gexPositioningFromHeatmap + computeGexWalls). Kept a plain numeric
 *  shape so the regime logic is testable without touching any provider. */
export type PinRegimeInput = {
  spot: number;
  callWall: number | null;
  putWall: number | null;
  /** Top call-wall's share of ladder |gamma| (%) — dominance of the resistance node. */
  callWallPct: number | null;
  /** Top put-wall's share of ladder |gamma| (%) — dominance of the support node. */
  putWallPct: number | null;
  /** Dealer gamma posture vs flip: "long" is the ONLY posture that pins. */
  gammaPosture: "long" | "short" | null;
};

export type PinRegime = {
  /** Fade toward the pin: long when spot is in the LOWER half (near the put wall), short in the
   *  UPPER half (near the call wall). */
  fadeDirection: "long" | "short";
  /** The pin/target — geometric midpoint of the defended band. */
  pin: number;
  /** Band width as a % of spot (call_wall − put_wall)/spot·100. */
  bandWidthPct: number;
  /** Off-center offset toward the near wall, fraction of half-width ∈ [0,1] (0 = dead center). */
  offset: number;
  /** min(callWallPct, putWallPct) — the weaker of the two brackets, the binding dominance. */
  bracketDomPct: number;
};

/**
 * Decide whether `input` is a genuine dealer-defended long-gamma pin, and if so which way the
 * mean-reversion fade points. Returns null (NOT a pin) whenever any regime condition fails — the
 * caller then emits nothing for that ticker (never fabricates a fade). Pure + deterministic.
 */
export function evaluatePinRegime(input: PinRegimeInput): PinRegime | null {
  const { spot, callWall, putWall, callWallPct, putWallPct, gammaPosture } = input;
  // 1. long-gamma only — the pinning regime.
  if (gammaPosture !== "long") return null;
  // 2. a real two-sided bracket around spot.
  if (callWall == null || putWall == null || !Number.isFinite(callWall) || !Number.isFinite(putWall)) return null;
  if (!(spot > 0) || !(putWall < spot && spot < callWall)) return null;
  // 4. both walls genuinely dominant.
  if (callWallPct == null || putWallPct == null) return null;
  const bracketDomPct = Math.min(callWallPct, putWallPct);
  if (!(bracketDomPct >= PIN_WALL_MIN_DOM_PCT)) return null;
  // 3. band width contained.
  const bandWidthPct = ((callWall - putWall) / spot) * 100;
  if (!(bandWidthPct >= PIN_BAND_MIN_PCT && bandWidthPct <= PIN_BAND_MAX_PCT)) return null;
  // 5. off-center toward a wall, but not hugging it.
  const mid = (callWall + putWall) / 2;
  const halfWidth = (callWall - putWall) / 2;
  const offset = halfWidth > 0 ? Math.abs(spot - mid) / halfWidth : 0;
  if (!(offset >= PIN_MIN_OFFSET && offset <= PIN_MAX_OFFSET)) return null;
  // Fade toward the pin (midpoint): below center → revert UP (long); above center → revert DOWN (short).
  const fadeDirection: "long" | "short" = spot < mid ? "long" : "short";
  return {
    fadeDirection,
    pin: Math.round(mid * 100) / 100,
    bandWidthPct: Math.round(bandWidthPct * 100) / 100,
    offset: Math.round(offset * 1000) / 1000,
    bracketDomPct: Math.round(bracketDomPct * 100) / 100,
  };
}

// ── Pin-strength score (0–100, the SAME scale the flow/breakout score uses — G-3's 65 floor
//    judges all three) ──────────────────────────────────────────────────────────────────────
// Deliberately CONSERVATIVE: a genuinely dealer-defended, long-gamma, spot-mid-range pin clears
// the 65 commit floor; a weak or ambiguous one scores low. Structure mirrors the breakout score:
//
//   core   = dominanceFactor · containmentFactor                              ∈ [0,1]
//   score  = core · CORE_MAX  +  fadeEdgeFactor · EDGE_MAX
//
// The core is MULTIPLICATIVE on purpose — it takes BOTH a strongly-defended bracket AND a tightly
// contained band. A pair of thin walls (low dominance) collapses the core to ~0 no matter how tight
// the band; a very wide "range" (poor containment) collapses it no matter how dominant the walls.
//   dominanceFactor  = clamp01(min(callWallPct, putWallPct) / DOM_FULL)   — both walls must be big
//   containmentFactor= clamp01((BAND_LOOSE − bandWidthPct)/(BAND_LOOSE − BAND_TIGHT)) — tighter=better
// The additive fadeEdge term rewards having room to revert (spot off-center toward a wall), capped
// so edge ALONE can never lift a weak/ill-defined bracket over the floor:
//   fadeEdgeFactor   = clamp01(offset / EDGE_FULL)
// Worked examples (offset = 0.6, near the middle of the allowed fade band):
// Recalibrated 2026-07-28 alongside BREAKOUT: prior map needed ~9%+ walls + 2% band to clear 65,
// so PIN almost never committed on a live long-gamma day. A genuine regime-qualified pin (already
// past evaluatePinRegime) with solid walls must be able to clear the shared floor.
//   both walls 4% (bracket floor), band 6% (containment floor)  → core 0     → score  ~15 (below 65)
//   both walls 6%, band 4%                                       → core ~0.33 → score  ~45 (below 65)
//   both walls 7.5%, band 2.5%                                   → core ~0.67 → score  ~70 (clears)
//   both walls 10%+, band ≤1.5% (tight, dominant)               → core 1.00  → score ~95 (textbook)
export const PIN_SCORE_BASE = 15; // points for clearing the structural pin regime filter
export const PIN_DOM_FULL_PCT = 9; // both-wall dominance (%) that saturates the dominance factor
export const PIN_BAND_TIGHT_PCT = 1.5; // band at/below this (%) = full containment
export const PIN_BAND_LOOSE_PCT = 6; // band at/above this (%) = zero containment (matches BAND_MAX)
export const PIN_CORE_MAX = 70; // max points from the multiplicative dominance×containment core
export const PIN_EDGE_MAX = 15; // max additive points from fade-room (off-center offset)
export const PIN_EDGE_FULL = 0.6; // offset (fraction of half-width) that saturates the fade-edge term

/**
 * Map one evaluated pin regime to a 0–100 board score. Pure + deterministic. Only ever called on a
 * regime that already passed evaluatePinRegime, so its inputs are in-band; the clamps are defensive.
 */
export function pinScore(regime: Pick<PinRegime, "bracketDomPct" | "bandWidthPct" | "offset">): number {
  const dominanceFactor = clamp01(regime.bracketDomPct / PIN_DOM_FULL_PCT);
  const containmentFactor = clamp01(
    (PIN_BAND_LOOSE_PCT - regime.bandWidthPct) / (PIN_BAND_LOOSE_PCT - PIN_BAND_TIGHT_PCT)
  );
  const core = dominanceFactor * containmentFactor; // multiplicative — needs BOTH
  const fadeEdgeFactor = clamp01(regime.offset / PIN_EDGE_FULL);
  const raw = PIN_SCORE_BASE + core * PIN_CORE_MAX + fadeEdgeFactor * PIN_EDGE_MAX;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

// ── ATM contract picker (seed→setup bridge) ───────────────────────────────────────────────
// A pin candidate is a bare ticker with NO option flow, so it can't go through deriveZeroDteSetups.
// This picks a same-day (0DTE) ATM contract — weekly fallback — off the live chain, on the FADE
// side (a CALL for a long/up fade, a PUT for a short/down fade), so the EXISTING attachContractPlans
// → buildContractPlan path (scan.ts) can attach a REAL, gated plan. Pure over the chain rows the
// provider already fetched. Mirrors breakout-source.ts's pickAtmZeroDteContract, generalized to a side.

/** Minimal chain-row shape the picker reads — a structural subset of ChainStrikeRow (both sides) so
 *  the picker is testable with plain objects and never imports the provider-heavy chain module. */
export type PinChainRow = {
  expiry: string;
  strike: number;
  call_bid: number | null;
  call_ask: number | null;
  call_oi: number;
  put_bid: number | null;
  put_ask: number | null;
  put_oi: number;
};

export type PickedPinContract = {
  strike: number;
  expiry: string;
  /** Calendar DTE from `today` (0 = same-day 0DTE). */
  dte: number;
  /** Which option side was picked for the fade. */
  side: "call" | "put";
};

/** A row is tradeable enough to seed a plan when the CHOSEN side has a live quote (bid or ask) or real OI. */
function sideHasLiquidity(row: PinChainRow, side: "call" | "put"): boolean {
  if (side === "call") {
    return (row.call_bid != null && row.call_bid > 0) || (row.call_ask != null && row.call_ask > 0) || row.call_oi > 0;
  }
  return (row.put_bid != null && row.put_bid > 0) || (row.put_ask != null && row.put_ask > 0) || row.put_oi > 0;
}

/**
 * Pick the ATM contract on `side` on the nearest usable expiry ≥ today, WITHIN the 0DTE/Day-Trade
 * horizon. 0DTE (dte 0) is preferred, then dte 1-4 (ONE_DTE). HORIZON INTEGRITY (PR-1, design Q2;
 * widened 2026-08-06 — design Q2 amendment): `maxDte` defaults to `ZERODTE_MAX_DTE` (4), sourced
 * from horizons.ts rather than a hardcoded copy — the picker still deliberately never reaches a
 * dte≥5 weekly. A pin whose only liquid contract on `side` is a farther-out weekly returns null
 * here → the candidate is DROPPED (never committed to the 0DTE ledger, never graded with the
 * same-day 15:30 time-stop that would be structurally wrong for a multi-day weekly). ATM = strike
 * closest to spot among liquid rows on the chosen expiry (nearest-expiry wins over ATM-ness, then
 * closest-to-spot, then lower strike — deterministic).
 * Returns null when no liquid contract sits inside the window (→ dropped).
 */
export function pickAtmPinContract(
  rows: PinChainRow[],
  spot: number,
  todayYmd: string,
  side: "call" | "put",
  maxDte = ZERODTE_MAX_DTE
): PickedPinContract | null {
  if (!(spot > 0) || rows.length === 0) return null;
  type Cand = { strike: number; expiry: string; dte: number; dist: number };
  const cands: Cand[] = [];
  for (const row of rows) {
    if (!sideHasLiquidity(row, side)) continue;
    const dte = calendarDteBetween(todayYmd, row.expiry);
    if (!Number.isFinite(dte) || dte < 0 || dte > maxDte) continue;
    cands.push({ strike: row.strike, expiry: row.expiry.slice(0, 10), dte, dist: Math.abs(row.strike - spot) });
  }
  if (cands.length === 0) return null;
  cands.sort((a, b) => a.dte - b.dte || a.dist - b.dist || a.strike - b.strike);
  const best = cands[0]!;
  return { strike: best.strike, expiry: best.expiry, dte: best.dte, side };
}

// ── Seed→setup bridge ───────────────────────────────────────────────────────────────────────

/**
 * Build an EnrichedZeroDteSetup-shaped candidate for one pin regime + its picked ATM contract.
 * discovery_origin is ["PIN"], direction is the fade direction, and the score is the conservative
 * pin score. Flow-only fields are HONEST nulls/neutral (never fabricated). otm_pct is REAL: for a
 * call fade it is (strike − spot)/spot; for a put fade it is (spot − strike)/spot — so positive is
 * OTM on either side, matching the ZeroDteSetup field contract. Run through enrichSetup(., null) so
 * it carries the full enriched shape exactly like a dossier-less setup — then the scan's shared
 * attachContractPlans/attachIntradayEdge/attachConfluence/attachGateVerdicts run on it unchanged.
 */
export function buildPinSetup(input: {
  ticker: string;
  spot: number;
  regime: PinRegime;
  contract: PickedPinContract;
  /** Today's ET session date (YYYY-MM-DD) — used ONLY to compute the evidence-only
   *  `session_gap_days` field (NH-R4). Optional so existing callers/tests keep compiling;
   *  omitted → session_gap_days is null (never fabricated). */
  todayYmd?: string;
  /** ISO-8601 observation time of `spot`, when the caller knows it. Stamped onto
   *  `underlying_price_as_of`; omitted → null = as-of UNKNOWN (never fabricated). */
  spotAsOf?: string | null;
}): EnrichedZeroDteSetup {
  const { ticker, spot, regime, contract, todayYmd } = input;
  const score = pinScore(regime);
  // Real moneyness of the picked strike on its side (positive = OTM), rounded at the data layer.
  const otmPct =
    spot > 0
      ? Math.round(
          ((contract.side === "call" ? contract.strike - spot : spot - contract.strike) / spot) * 100 * 100
        ) / 100
      : null;
  const origin: DiscoveryOrigin[] = ["PIN"];
  const base: ZeroDteSetup = {
    ticker: ticker.toUpperCase(),
    direction: regime.fadeDirection,
    // A bare PIN candidate is the DIRECTIONAL mean-reversion fade (3b). The condor SELL play-type
    // is routed SEPARATELY (condor.ts, flag-gated), never here — so with the condor flag off a pin
    // is always the directional fade and the board is unchanged.
    play_type: "DIRECTIONAL",
    discovery_origin: origin,
    top_strike: contract.strike,
    top_strike_avg_fill: null, // no flow fill — attachContractPlans prices off the live mark
    expiry: contract.expiry,
    dte: contract.dte,
    // HORIZON stamped from the REAL selected-contract dte. The picker is clamped to dte ≤ 1, so a
    // committed pin fade is always ZERO_DTE/ONE_DTE; the derivation still maps a hypothetical dte≥2
    // to WEEKLY_FALLBACK (the persist-time guard would then drop it) — defense in depth.
    contract_horizon: deriveContractHorizon(contract.dte),
    actual_dte_at_commit: contract.dte,
    grading_policy: gradingPolicyForHorizon(deriveContractHorizon(contract.dte)),
    net_premium: 0, // no directional option premium — this is a dealer-positioning pin, not flow
    gross_premium: 0,
    prints: 0,
    sweep_pct: 0,
    side_dominance: 0.5, // neutral: no option-flow side to be dominant (flow gates are SKIPPED here)
    underlying_price: Math.round(spot * 100) / 100,
    // Provenance for the mark: the live GEX/chain spot this discovery pass just read. As-of only
    // when the caller knows it — never fabricated. A directional PIN fade also flows through
    // attachContractPlans, which re-stamps this off the batched live option snapshot.
    underlying_price_as_of: input.spotAsOf ?? null,
    underlying_price_source: "chain_spot",
    score,
    aggression: null, // honest null — there is no tape aggression for a bare pin
    otm_pct: otmPct,
    new_money: false,
    recent_premium_30m: 0,
    spike: false,
    first_seen: null,
    last_seen: null,
    flow_quality: null,
  };
  // NH-R4 (evidence-only): trading-session-aware gap days for the selected contract's hold, when
  // today's date is available. Null (never fabricated) when the caller omits it.
  const sessionGapDays = todayYmd != null ? tradingSessionGapDays(todayYmd, contract.expiry) : null;
  return { ...enrichSetup(base, null), session_gap_days: sessionGapDays };
}

// ── Merge (union by ticker, preserve origin as a SET) ─────────────────────────────────────────

/**
 * Merge pin setups into the existing setups IN PLACE, unioning origins by ticker (v2 policy via
 * {@link mergeSameTickerDiscovery}). Same-direction corroboration unions + boosts; opposing
 * directions are evidence-weighted (higher score owns the slot; seating-order wins ties — FLOW /
 * BREAKOUT seated before PIN). A pin-only ticker is appended. Mutates + returns `existing`.
 */
export function mergePinOrigins(
  existing: EnrichedZeroDteSetup[],
  pinSetups: EnrichedZeroDteSetup[]
): EnrichedZeroDteSetup[] {
  const byTicker = new Map<string, EnrichedZeroDteSetup>();
  for (const s of existing) byTicker.set(s.ticker.toUpperCase(), s);
  for (const p of pinSetups) {
    const key = p.ticker.toUpperCase();
    const found = byTicker.get(key);
    if (found) {
      const winner = mergeSameTickerDiscovery(found, p);
      if (winner !== found) {
        const idx = existing.indexOf(found);
        if (idx >= 0) existing[idx] = winner;
        byTicker.set(key, winner);
      }
    } else {
      byTicker.set(key, p);
      existing.push(p);
    }
  }
  return existing;
}

// ── G-1 (tape-alignment) interaction — the counter-tape/fade question, resolved ───────────────
// G-1 blocks a setup whose direction fights the BROAD-MARKET (SPY) tape bias: a long in a DOWN tape
// or a short in an UP tape (gates.ts). A fade is directional, so this matters. Resolution (design
// preference (a), and it holds because evaluatePinRegime is strict):
//   • G-1 reads the GLOBAL SPY bias, not the per-ticker tape. A PIN candidate is only emitted when
//     the TICKER is in a genuine long-gamma, dealer-defended, contained range (gamma_posture=long +
//     bracketed + tight band). That regime coincides with a NON-trending broad tape in the normal
//     case, so SPY bias is "flat" → G-1's `bias !== "flat"` guard is false → BOTH long and short
//     fades pass cleanly. This is the intended path.
//   • If the broad tape DOES carry a strong directional bias, G-1 correctly BLOCKS the fade that
//     opposes it — a pin fighting a trending market is not a durable pin. We deliberately do NOT
//     bypass or special-case G-1: the strict regime filter plus G-1 are defense-in-depth, and a
//     counter-trend fade being culled in a trending tape is a FEATURE (fail-safe), not a bug.
// So PIN needs no G-1 change; the strictness of evaluatePinRegime is what makes case (a) the norm.
