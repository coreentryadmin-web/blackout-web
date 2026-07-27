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
// FLAG-GATED OFF by default (both flags must be "1"): ZERODTE_WHOLE_MARKET (master) AND
// ZERODTE_SRC_BREAKOUT (per-source). When either is off, the board behaves EXACTLY as today.

import type { BreakoutMover } from "@/features/nighthawk/lib/candidates";
import {
  deriveContractHorizon,
  enrichSetup,
  gradingPolicyForHorizon,
  unionDiscoveryOrigins,
  noteOriginDirectionConflict,
  recordOriginContributionsOnMerge,
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
// Deliberately CONSERVATIVE: a breakout must be a big gain that CLOSES STRONG on real liquidity
// to clear the 65 commit floor — a weak-closing 5% pop on thin volume scores in the teens.
//
//   core   = clamp(gain / GAIN_FULL, 0, 1) · clamp((close_strength − 0.5) / 0.5, 0, 1)   ∈ [0,1]
//   score  = core · CORE_MAX  +  dollar_norm · DOLLAR_MAX
//
// The core is MULTIPLICATIVE on purpose (the design's "gain × close-strength"): a huge gain that
// fades into the close (close_strength → 0.5) collapses the core to ~0, and a strong close on a
// tiny gain likewise scores near-0 — it takes BOTH. The $-volume term is an ADDITIVE liquidity/
// conviction bonus normalized against the current cohort's max (like candidates.ts's
// normalizeToMax), capped at DOLLAR_MAX so liquidity ALONE can never lift a non-mover over the
// floor. Worked examples (dollar_norm = 1, the most generous liquidity):
//   5% gain, closed at 0.50 (screen floor)  → core 0     → score  20  (well below 65)
//   10% gain, closed at 0.75                → core 0.25   → score  40  (still below 65)
//   15% gain, closed at 0.90                → core 0.60   → score  68  (clears — genuinely strong)
//   20%+ gain, closed on the high (1.0)     → core 1.00   → score 100
// So a breakout does NOT auto-clear 65 without a real, strong-closing, liquid move.
export const BREAKOUT_GAIN_FULL = 0.20; // gain that saturates the gain factor (20% intraday)
export const BREAKOUT_CORE_MAX = 80; // max points from the multiplicative gain×close core
export const BREAKOUT_DOLLAR_MAX = 20; // max additive points from normalized $-volume

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Map one breakout mover to a 0–100 board score. `dollarNorm` is this mover's $-volume divided by
 * the cohort maximum (in [0,1]); the caller normalizes so the score is comparable within a scan.
 * Pure + deterministic.
 */
export function breakoutScore(mover: Pick<BreakoutMover, "gain" | "close_strength">, dollarNorm: number): number {
  const gainFactor = clamp01(mover.gain / BREAKOUT_GAIN_FULL);
  // close_strength ∈ [0.5, 1] after the screen; below 0.5 the screen already dropped it.
  const closeFactor = clamp01((mover.close_strength - 0.5) / 0.5);
  const core = gainFactor * closeFactor; // multiplicative — needs BOTH
  const dollar = clamp01(dollarNorm);
  const raw = core * BREAKOUT_CORE_MAX + dollar * BREAKOUT_DOLLAR_MAX;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

// ── ATM 0DTE contract picker (seed→setup bridge) ────────────────────────────────────
// A breakout candidate is a bare ticker with NO option flow, so it can't go through
// deriveZeroDteSetups (which aggregates flow prints). This picks a same-day (0DTE) contract —
// weekly fallback — off the live chain so the EXISTING attachContractPlans → buildContractPlan
// path (scan.ts) can attach a REAL, gated plan. Long-only for 3a (breakouts are up-moves), so
// the picked side is always a CALL. Pure over the chain rows the provider already fetched.

/** Minimal chain-row shape the picker reads — a structural subset of ChainStrikeRow so the
 *  picker is testable with plain objects and never imports the (provider-heavy) chain module. */
export type BreakoutChainRow = {
  expiry: string;
  strike: number;
  call_bid: number | null;
  call_ask: number | null;
  call_oi: number;
};

export type PickedBreakoutContract = {
  strike: number;
  expiry: string;
  /** Calendar DTE from `today` (0 = same-day 0DTE). */
  dte: number;
};

/** Calendar days between two YYYY-MM-DD dates (UTC-noon anchored, DST-agnostic). */
function calendarDteBetween(todayYmd: string, expiryYmd: string): number {
  const a = Date.parse(`${todayYmd}T12:00:00Z`);
  const b = Date.parse(`${expiryYmd.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
  return Math.round((b - a) / 86_400_000);
}

/** A call row is tradeable enough to seed a plan when it has a live quote (bid or ask) or real OI. */
function callHasLiquidity(row: BreakoutChainRow): boolean {
  return (row.call_bid != null && row.call_bid > 0) || (row.call_ask != null && row.call_ask > 0) || row.call_oi > 0;
}

/**
 * Pick the ATM CALL contract on the nearest usable expiry ≥ today, WITHIN the 0DTE horizon.
 * 0DTE (dte 0) is preferred, then dte 1 (ONE_DTE). HORIZON INTEGRITY (PR-1, design Q2): `maxDte`
 * is clamped to 1 — the picker DELIBERATELY no longer reaches a 2–7DTE weekly. A breakout mover
 * whose only liquid call is a weekly returns null here → the candidate is DROPPED (never committed
 * to the 0DTE ledger, never graded with the same-day 15:30 time-stop that would be structurally
 * wrong for a multi-day weekly). Re-homing weekly fallbacks to a TACTICAL_SWING lane is a later
 * effort; for now they are cleanly excluded. ATM = strike closest to spot among liquid call rows on
 * the chosen expiry (nearest-expiry wins over ATM-ness, then closest-to-spot, then lower strike —
 * deterministic). Returns null when no liquid same-day/1DTE call exists (→ no contract → dropped).
 */
export function pickAtmZeroDteContract(
  rows: BreakoutChainRow[],
  spot: number,
  todayYmd: string,
  maxDte = 1
): PickedBreakoutContract | null {
  if (!(spot > 0) || rows.length === 0) return null;
  type Cand = { strike: number; expiry: string; dte: number; dist: number };
  const cands: Cand[] = [];
  for (const row of rows) {
    if (!callHasLiquidity(row)) continue;
    const dte = calendarDteBetween(todayYmd, row.expiry);
    if (!Number.isFinite(dte) || dte < 0 || dte > maxDte) continue;
    cands.push({ strike: row.strike, expiry: row.expiry.slice(0, 10), dte, dist: Math.abs(row.strike - spot) });
  }
  if (cands.length === 0) return null;
  // Nearest expiry first (0DTE preferred, then 1DTE within the clamped horizon), then closest-to-
  // spot, then the lower strike — the same deterministic tie-break shape pickChainContract uses.
  cands.sort((a, b) => a.dte - b.dte || a.dist - b.dist || a.strike - b.strike);
  const best = cands[0]!;
  return { strike: best.strike, expiry: best.expiry, dte: best.dte };
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
}): EnrichedZeroDteSetup {
  const { mover, spot, contract, dollarNorm } = input;
  const score = breakoutScore(mover, dollarNorm);
  // Real moneyness of the picked call strike (positive = OTM), rounded at the data layer.
  const otmPct = spot > 0 ? Math.round(((contract.strike - spot) / spot) * 100 * 100) / 100 : null;
  const base: ZeroDteSetup = {
    ticker: mover.ticker.toUpperCase(),
    direction: "long",
    // Breakout candidates are always DIRECTIONAL long-momentum plays — never a condor (the condor is
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
  return enrichSetup(base, null);
}

// ── Merge + dedup (union by ticker, preserve origin as a SET) ─────────────────────────

/**
 * Merge breakout setups into the flow setups IN PLACE, unioning origins by ticker. A ticker
 * already present in `flowSetups` keeps its (evidence-bearing) flow setup and gains "BREAKOUT" in
 * its discovery_origin set (→ ["FLOW","BREAKOUT"]); the duplicate breakout setup is dropped. A
 * ticker unique to the breakout source is appended. NO corroboration score boost (evidence-only —
 * the origin band earns any boost later on graded outcomes). Mutates + returns `flowSetups`.
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
      // Same ticker from two sources → union the origins onto the flow setup, keep the flow
      // evidence (real prints/aggression), drop the bare breakout duplicate. No score change.
      // Q1: if breakout argued the OPPOSITE direction, stamp the masked read as evidence
      // (never flip the kept direction) so the origin band can grade opposing co-discovery.
      // WS-06: record BOTH rails' (direction, score) BEFORE the union rewrites discovery_origin,
      // so the frozen origin maps capture every disagreement, not just the first conflict pair.
      recordOriginContributionsOnMerge(existing, b);
      noteOriginDirectionConflict(existing, b);
      existing.discovery_origin = unionDiscoveryOrigins(existing.discovery_origin, b.discovery_origin);
    } else {
      byTicker.set(key, b);
      flowSetups.push(b);
    }
  }
  return flowSetups;
}
