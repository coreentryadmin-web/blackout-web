// ── BREAKOUT discovery origin (Phase 3a, docs/audit/0DTE-UNIFICATION-DESIGN.md §1a) ──
// The FIRST of three INDEPENDENT whole-market discovery sources that feed the ONE live 0DTE
// board. Today the board discovers candidates from OPTIONS FLOW ONLY (fetchRecentFlows →
// deriveZeroDteSetups) — a clean price/volume breakout with no whale option print is invisible.
// This source screens the WHOLE market for gain × volume × close-strength breakouts (reusing
// screenBreakoutMovers, the same screen the edition's banger lane uses) and emits its own
// candidates carrying discovery_origin ["BREAKOUT"]. They merge with the flow candidates BY
// TICKER, preserving the origin as a SET, and then run through the SAME contract-attach + gate
// stack + Cortex + governor as every flow candidate.
//
// This module is PURE (no IO): the score mapping, the ATM-0DTE contract picker, the seed→setup
// bridge, and the merge. The IO orchestration (fetch the intraday breadth snapshot + per-ticker
// chain) lives in breakout-discovery.ts, which is dynamic-imported only when the source is
// flag-enabled — so the flow-only board never loads the whole-market provider graph.
//
// FLAG-GATED ON by default (set either to "0" to disable): ZERODTE_WHOLE_MARKET (master) AND
// ZERODTE_SRC_BREAKOUT (per-source). When either is off, the board is FLOW-only.

import type { BreakoutMover } from "@/features/nighthawk/lib/candidates";
import { ZERODTE_MAX_DTE } from "@/lib/horizons";
import {
  calendarDteBetween,
  deriveContractHorizon,
  enrichSetup,
  gradingPolicyForHorizon,
  mergeSameTickerDiscovery,
  tradingSessionGapDays,
  type EnrichedZeroDteSetup,
  type ZeroDteSetup,
} from "./board";

// ── Flags (read at call time so tests can toggle process.env per case) ──────────────
// Default ON: the three discovery systems are production-ready and must survive ECS
// task-definition updates that don't carry env vars. Set to "0" to disable.
/** Master whole-market switch. ON by default. Set ZERODTE_WHOLE_MARKET=0 to disable. */
export function wholeMarketEnabled(): boolean {
  return process.env.ZERODTE_WHOLE_MARKET !== "0";
}
/** Per-source BREAKOUT switch. ON by default. Set ZERODTE_SRC_BREAKOUT=0 to disable. */
export function breakoutSrcFlagEnabled(): boolean {
  return process.env.ZERODTE_SRC_BREAKOUT !== "0";
}
/** The breakout source runs only when BOTH the master and the per-source flag are on. */
export function breakoutSourceEnabled(): boolean {
  return wholeMarketEnabled() && breakoutSrcFlagEnabled();
}

// ── Score mapping (0–100, the SAME scale the flow score uses — G-3's 65 floor judges both) ──
// Recalibrated 2026-07-28 (engine throughput): the prior map needed ~15%+ strong-close movers to
// clear 65, so the whole-market BREAKOUT rail (~12k names → ≤15 chain-fetches) almost never
// committed. Live 2026-07-28: 1 OPEN all day, 100% FLOW. A liquid 8–10% strong-close continuation
// is a real 0DTE candidate and must be able to clear the shared floor.
//
//   score = BASE + core·CORE_MAX + dollar_norm·DOLLAR_MAX
//   core  = clamp(gain / GAIN_FULL, 0, 1) · closeFactor ∈ [0,1]   (multiplicative — needs BOTH)
//
// BASE credits the liquidity/gain screen the mover already cleared (not a free pass — weak closes
// still collapse the core). Worked examples (dollar_norm = 1):
//   5% gain, closed at 0.50 (screen floor)  → core 0     → score  25  (well below 65)
//   6% gain, closed at 0.80                → core 0.36   → score  ~57 (still below 65)
//   8% gain, closed at 0.90                → core 0.64   → score  ~73 (clears — real continuation)
//   10% gain, closed at 0.80               → core 0.60   → score  ~70 (clears)
//   15%+ gain, closed on the high          → core →1     → score 100
export const BREAKOUT_SCORE_BASE = 15; // points for clearing the liquidity/gain screen
export const BREAKOUT_GAIN_FULL = 0.1; // gain that saturates the gain factor (10% intraday)
export const BREAKOUT_CORE_MAX = 75; // max points from the multiplicative gain×close core
export const BREAKOUT_DOLLAR_MAX = 10; // max additive points from normalized $-volume

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Map one breakout/breakdown mover to a 0-100 board score. `dollarNorm` is this mover's $-volume
 * divided by the cohort maximum (in [0,1]); the caller normalizes so the score is comparable
 * within a scan. Pure + deterministic.
 *
 * For breakouts (direction "long"), `gain` is positive and close_strength is in [0.5, 1] (closed
 * strong = bullish conviction). For breakdowns (direction "short"), `gain` is the ABSOLUTE value
 * of the drop and close_strength is in [0, 0.5] (closed weak = bearish conviction). The
 * `direction` parameter flips the close-strength factor so both sides score symmetrically.
 */
export function breakoutScore(
  mover: Pick<BreakoutMover, "gain" | "close_strength">,
  dollarNorm: number,
  direction: "long" | "short" = "long"
): number {
  // Use abs(gain) so the formula works for both positive breakouts and negative breakdowns
  // (screenBreakdownMovers already stores gain as abs, but be defensive).
  const gainFactor = clamp01(Math.abs(mover.gain) / BREAKOUT_GAIN_FULL);
  // For breakouts: close_strength in [0.5, 1] after the screen; higher = stronger close.
  // For breakdowns: close_strength in [0, 0.5]; LOWER = stronger bearish close (near the low).
  // Flip the factor for shorts so closing near the low scores high.
  const closeFactor =
    direction === "long"
      ? clamp01((mover.close_strength - 0.5) / 0.5)
      : clamp01((0.5 - mover.close_strength) / 0.5);
  const core = gainFactor * closeFactor; // multiplicative -- needs BOTH
  const dollar = clamp01(dollarNorm);
  const raw = BREAKOUT_SCORE_BASE + core * BREAKOUT_CORE_MAX + dollar * BREAKOUT_DOLLAR_MAX;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

// ── ATM 0DTE contract picker (seed→setup bridge) ────────────────────────────────────
// A breakout candidate is a bare ticker with NO option flow, so it can't go through
// deriveZeroDteSetups (which aggregates flow prints). This picks a same-day (0DTE) contract —
// weekly fallback — off the live chain so the EXISTING attachContractPlans → buildContractPlan
// path (scan.ts) can attach a REAL, gated plan. Breakouts pick a CALL; breakdowns pick a PUT.
// Pure over the chain rows the provider already fetched.

/** Minimal chain-row shape the picker reads — a structural subset of ChainStrikeRow so the
 *  picker is testable with plain objects and never imports the (provider-heavy) chain module.
 *  Includes BOTH sides so the same row type works for breakout (call) and breakdown (put). */
export type BreakoutChainRow = {
  expiry: string;
  strike: number;
  call_bid: number | null;
  call_ask: number | null;
  call_oi: number;
  put_bid: number | null;
  put_ask: number | null;
  put_oi: number;
};

export type PickedBreakoutContract = {
  strike: number;
  expiry: string;
  /** Calendar DTE from `today` (0 = same-day 0DTE). */
  dte: number;
};

/** A row's chosen side is tradeable enough to seed a plan when it has a live quote (bid or ask) or real OI. */
function sideHasLiquidity(row: BreakoutChainRow, side: "call" | "put"): boolean {
  if (side === "call") {
    return (row.call_bid != null && row.call_bid > 0) || (row.call_ask != null && row.call_ask > 0) || row.call_oi > 0;
  }
  return (row.put_bid != null && row.put_bid > 0) || (row.put_ask != null && row.put_ask > 0) || row.put_oi > 0;
}

/** NH-R5 fix: spread quality clips at this pct-of-mid — a two-sided quote wider than 25% of mid
 *  earns zero spread credit (still admitted by sideHasLiquidity, just ranked no better than a
 *  quoteless OI-only row on this dimension). */
const SPREAD_QUALITY_CLIP_PCT = 0.25;

/** OI beyond this depth earns no further quality credit (diminishing returns) — 500 contracts is
 *  comfortably past "thin" for a 0DTE ATM strike on a liquid mover; more OI past that doesn't make
 *  a strike materially easier to fill. */
const OI_QUALITY_SATURATION = 500;

/** How many dollars of ATM distance one full quality point (max 2.0: spread credit + OI credit) is
 *  "worth" when tie-breaking near-ATM candidates. Deliberately small — a strike 1+ points closer to
 *  spot still wins regardless of liquidity; this only decides between strikes that are ALREADY
 *  close (the ATM pick stays ATM-first, quality only breaks genuine near-ties). */
const LIQUIDITY_TIE_BREAK_DOLLARS_PER_POINT = 0.15;

/**
 * NH-R5 fix: `sideHasLiquidity` was a pure binary admission gate — every row that cleared it
 * (any non-zero bid/ask/OI) then ranked purely on distance-to-spot, so a strike with a razor-thin
 * quote and 1 contract of OI could beat an equally-close strike with a tight two-sided market and
 * real depth. This scores REAL liquidity quality — spread tightness (tighter = better, clipped at
 * `SPREAD_QUALITY_CLIP_PCT`) plus OI depth (more = better, saturating at `OI_QUALITY_SATURATION`)
 * — each contributing up to 1.0, so the composite ranges 0–2. A quoteless OI-only row (the
 * `sideHasLiquidity` OI>0 branch with no live bid/ask) scores only the OI component, honestly
 * reflecting that its fill quality is unknown. */
export function liquidityQualityScore(row: BreakoutChainRow, side: "call" | "put"): number {
  const bid = side === "call" ? row.call_bid : row.put_bid;
  const ask = side === "call" ? row.call_ask : row.put_ask;
  const oi = side === "call" ? row.call_oi : row.put_oi;

  let score = 0;
  if (bid != null && bid > 0 && ask != null && ask > 0 && ask >= bid) {
    const mid = (bid + ask) / 2;
    const spreadPct = mid > 0 ? (ask - bid) / mid : 1;
    score += Math.max(0, Math.min(1, 1 - spreadPct / SPREAD_QUALITY_CLIP_PCT));
  }
  score += Math.max(0, Math.min(1, oi / OI_QUALITY_SATURATION));
  return score;
}

/**
 * Pick the ATM contract on `side` on the nearest usable expiry >= today, WITHIN the 0DTE horizon.
 * 0DTE (dte 0) is preferred, then dte 1 (ONE_DTE). HORIZON INTEGRITY (PR-1, design Q2): `maxDte`
 * is clamped to 1 -- the picker DELIBERATELY no longer reaches a 2-7DTE weekly. A mover whose only
 * liquid contract on the chosen side is a weekly returns null here -> the candidate is DROPPED
 * (never committed to the 0DTE ledger, never graded with the same-day 15:30 time-stop that would
 * be structurally wrong for a multi-day weekly). ATM = strike closest to spot among liquid rows on
 * the chosen expiry (nearest-expiry wins over ATM-ness, then closest-to-spot, then lower strike --
 * deterministic). Returns null when no liquid same-day/1DTE contract exists (-> dropped).
 *
 * `side` defaults to "call" for backward compatibility (breakouts are long/call). Breakdowns pass
 * "put" so the picked contract matches the short direction.
 */
export function pickAtmZeroDteContract(
  rows: BreakoutChainRow[],
  spot: number,
  todayYmd: string,
  maxDte = ZERODTE_MAX_DTE,
  side: "call" | "put" = "call"
): PickedBreakoutContract | null {
  if (!(spot > 0) || rows.length === 0) return null;
  type Cand = { strike: number; expiry: string; dte: number; dist: number; effectiveDist: number };
  const cands: Cand[] = [];
  for (const row of rows) {
    if (!sideHasLiquidity(row, side)) continue;
    const dte = calendarDteBetween(todayYmd, row.expiry);
    if (!Number.isFinite(dte) || dte < 0 || dte > maxDte) continue;
    const dist = Math.abs(row.strike - spot);
    const quality = liquidityQualityScore(row, side);
    cands.push({
      strike: row.strike,
      expiry: row.expiry.slice(0, 10),
      dte,
      dist,
      // NH-R5: quality only narrows near-ties (LIQUIDITY_TIE_BREAK_DOLLARS_PER_POINT is small) —
      // a strike materially closer to spot still wins regardless of liquidity quality.
      effectiveDist: dist - quality * LIQUIDITY_TIE_BREAK_DOLLARS_PER_POINT,
    });
  }
  if (cands.length === 0) return null;
  // Nearest expiry first (0DTE preferred, then 1DTE within the clamped horizon), then closest-to-
  // spot NET OF liquidity quality (NH-R5), then the lower strike -- deterministic.
  cands.sort((a, b) => a.dte - b.dte || a.effectiveDist - b.effectiveDist || a.strike - b.strike);
  const best = cands[0]!;
  return { strike: best.strike, expiry: best.expiry, dte: best.dte };
}

/** Phase 2a — env-gated near-dated fallback when no listed 0DTE contract clears liquidity.
 *  Default ON (`ZERODTE_BREAKOUT_ALLOW_1DTE` unset or `1`); set `=0` for strict 0DTE-only BREAKOUT.
 *  Name kept as `ALLOW_1DTE` (not renamed to `ALLOW_NEAR_DATED`) so this remains the exact same
 *  live operator toggle post-2026-08-06 widening — flipping it to `0` still forces strict 0DTE-only,
 *  it just now withholds the wider dte 1-4 window instead of only dte=1. */
export function breakoutAllow1DteFallback(): boolean {
  return process.env.ZERODTE_BREAKOUT_ALLOW_1DTE !== "0";
}

export type PickedBreakoutContractWithFallback = PickedBreakoutContract & {
  /** True when the picker fell back past dte=0 because no liquid 0DTE existed (now dte 1-4, the
   *  widened ONE_DTE window — see ZERODTE_MAX_DTE in horizons.ts). Field name kept for compat. */
  used_1dte_fallback: boolean;
};

/**
 * Explicit two-phase BREAKOUT contract pick: try 0DTE first, then (when env allows) the widened
 * dte 1-4 window. Equivalent to `pickAtmZeroDteContract(..., maxDte=ZERODTE_MAX_DTE)` when
 * fallback is ON (nearest-expiry-first sort means this can never prefer a farther contract over a
 * nearer one); when OFF, 0DTE-only — preserves the exact live `ZERODTE_BREAKOUT_ALLOW_1DTE=0`
 * operator toggle semantics (2026-08-06 adversarial review: the original widening draft would have
 * silently made this toggle a no-op by collapsing straight to an unconditional maxDte bump).
 * Returns null when no horizon within the allowed window has a liquid same-day contract.
 */
export function pickBreakoutContractWithFallback(
  rows: BreakoutChainRow[],
  spot: number,
  todayYmd: string,
  side: "call" | "put" = "call"
): PickedBreakoutContractWithFallback | null {
  const zero = pickAtmZeroDteContract(rows, spot, todayYmd, 0, side);
  if (zero) return { ...zero, used_1dte_fallback: false };
  if (!breakoutAllow1DteFallback()) return null;
  const maxDte = ZERODTE_MAX_DTE;
  const widened = pickAtmZeroDteContract(rows, spot, todayYmd, maxDte, side);
  if (!widened || widened.dte < 1 || widened.dte > maxDte) return null;
  return { ...widened, used_1dte_fallback: true };
}

// ── Seed→setup bridge ───────────────────────────────────────────────────────────────

/**
 * Build an EnrichedZeroDteSetup-shaped candidate for one breakout mover + its picked ATM 0DTE
 * contract. discovery_origin is ["BREAKOUT"], direction long, and the score is the conservative
 * breakout score. Flow-only fields are set to HONEST nulls/neutral (never fabricated): no
 * aggression, no side dominance signal (0.5 = "no dominant side measured"), no sweeps, no prints,
 * no flow fill, no flow-quality. otm_pct is REAL (the chosen strike's distance from spot). The
 * setup is run through enrichSetup(., null) so it carries the full enriched shape (condor,
 * technicals null, etc.) exactly like a dossier-less flow setup — then the scan's shared
 * attachContractPlans/attachIntradayEdge/attachConfluence/attachGateVerdicts run on it unchanged.
 */
export function buildBreakoutSetup(input: {
  mover: Pick<BreakoutMover, "ticker" | "gain" | "close_strength" | "volume" | "dollar">;
  spot: number;
  contract: PickedBreakoutContract;
  dollarNorm: number;
  /** Direction for this candidate: "long" for breakouts (up-moves), "short" for breakdowns
   *  (gap-down movers). Defaults to "long" for backward compatibility. */
  direction?: "long" | "short";
  /** Today's ET session date (YYYY-MM-DD) — used ONLY to compute the evidence-only
   *  `session_gap_days` field (NH-R4). Optional so existing callers/tests keep compiling;
   *  omitted → session_gap_days is null (never fabricated). */
  todayYmd?: string;
}): EnrichedZeroDteSetup {
  const { mover, spot, contract, dollarNorm, todayYmd } = input;
  const direction = input.direction ?? "long";
  const score = breakoutScore(mover, dollarNorm, direction);
  // Real moneyness of the picked strike (positive = OTM), rounded at the data layer.
  // For a call (long): OTM = strike above spot. For a put (short): OTM = strike below spot.
  const otmPct =
    spot > 0
      ? Math.round(
          ((direction === "long" ? contract.strike - spot : spot - contract.strike) / spot) * 100 * 100
        ) / 100
      : null;
  const base: ZeroDteSetup = {
    ticker: mover.ticker.toUpperCase(),
    direction,
    // Breakout/breakdown candidates are always DIRECTIONAL plays -- never a condor (the condor is
    // routed only from PIN, condor.ts). Stamped explicitly so the flag-off board is unchanged.
    play_type: "DIRECTIONAL",
    discovery_origin: ["BREAKOUT"],
    top_strike: contract.strike,
    top_strike_avg_fill: null, // no flow fill — attachContractPlans prices off the live mark
    expiry: contract.expiry,
    dte: contract.dte,
    // HORIZON stamped from the REAL selected-contract dte. The picker is clamped to dte ≤ 1, so a
    // committed breakout is always ZERO_DTE/ONE_DTE; the derivation still maps a hypothetical dte≥2
    // to WEEKLY_FALLBACK (the persist-time guard would then drop it) — defense in depth.
    contract_horizon: deriveContractHorizon(contract.dte),
    actual_dte_at_commit: contract.dte,
    grading_policy: gradingPolicyForHorizon(deriveContractHorizon(contract.dte)),
    net_premium: 0, // no directional option premium — this is a price/volume breakout
    gross_premium: 0,
    prints: 0,
    sweep_pct: 0,
    side_dominance: 0.5, // neutral: no option-flow side to be dominant (flow gates are SKIPPED here)
    underlying_price: Math.round(spot * 100) / 100,
    score,
    aggression: null, // honest null — there is no tape aggression for a bare breakout
    otm_pct: otmPct,
    new_money: false,
    recent_premium_30m: 0,
    spike: false,
    first_seen: null,
    last_seen: null,
    flow_quality: null,
  };
  // enrichSetup with a null dossier fills the enriched fields (condor from spot, technicals null,
  // gate/cortex/plan null) exactly as it does for an un-enriched flow setup — one code path.
  // NH-R4 (evidence-only): trading-session-aware gap days for the selected contract's hold, when
  // today's date is available. Null (never fabricated) when the caller omits it.
  const sessionGapDays = todayYmd != null ? tradingSessionGapDays(todayYmd, contract.expiry) : null;
  return { ...enrichSetup(base, null), session_gap_days: sessionGapDays };
}

// ── Merge + dedup (union by ticker, preserve origin as a SET) ─────────────────────────

/**
 * Merge breakout setups into the flow setups IN PLACE, unioning origins by ticker (v2 policy via
 * {@link mergeSameTickerDiscovery}). Same-direction corroboration unions origins and applies the
 * corroboration boost; opposing directions are evidence-weighted (higher score owns the slot;
 * seating-order wins ties — FLOW seated first). A ticker unique to the breakout source is appended.
 * Mutates + returns `flowSetups`.
 */
export function mergeDiscoveryOrigins(
  flowSetups: EnrichedZeroDteSetup[],
  breakoutSetups: EnrichedZeroDteSetup[]
): EnrichedZeroDteSetup[] {
  const byTicker = new Map<string, EnrichedZeroDteSetup>();
  for (const s of flowSetups) byTicker.set(s.ticker.toUpperCase(), s);
  for (const b of breakoutSetups) {
    const key = b.ticker.toUpperCase();
    const existing = byTicker.get(key);
    if (existing) {
      const winner = mergeSameTickerDiscovery(existing, b);
      if (winner !== existing) {
        const idx = flowSetups.indexOf(existing);
        if (idx >= 0) flowSetups[idx] = winner;
        byTicker.set(key, winner);
      }
    } else {
      byTicker.set(key, b);
      flowSetups.push(b);
    }
  }
  return flowSetups;
}
