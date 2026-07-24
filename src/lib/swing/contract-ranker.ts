// src/lib/swing/contract-ranker.ts — the SWING full-chain tradability×thesis-fit contract ranker (PR-4).
//
// WHY THIS EXISTS (SEV-4 / failure-mode #5): the SWING lane must NOT reuse the 0DTE/banger contract
// picker. A same-day lotto wants a cheap, low-delta (≈0.35Δ) OTM contract — maximum convexity, expiry
// today, decay irrelevant. A multi-SESSION directional thesis wants the OPPOSITE instrument: a
// 0.50–0.75Δ near-the-money contract that TRACKS the underlying, carries far less premium-decay drag,
// and — the decisive property — has BETTER BREAKEVEN HEADROOM (the underlying has to move much less for
// the position to profit). Wiring the low-delta banger into the swing lane would silently reintroduce
// FM#5 (the wrong instrument for the hold), so this ranker is the ONE contract picker the gate + serving
// path consume — never `fanOutContracts`' lane-fit picker and never the flow strike.
//
// The ranker is PURE. It filters a candidate's full chain to the sub-lane's DTE window, correct option
// right for the direction, contracts that clear the sub-lane liquidity gate (reusing the SAME
// `clearsLiquidity` primitive the 0DTE fan-out uses — one gate, not two), and whose |delta| sits in the
// sub-lane band, then scores each on:
//   • tradability (0–1): how cleanly you can get in AND out — spread tightness, quote size, OI, day volume.
//   • thesisFit  (0–1): how right the instrument is for THIS thesis — delta closeness to the sub-lane
//                        target, BREAKEVEN HEADROOM (see below), and DTE-fit inside the lane.
// score = tradability × thesisFit; pick = argmax (tie-break: tighter spread → bigger size → higher OI).
//
// FLOW-STRIKE PROVENANCE, NOT A DRIVER: the ranker RECORDS the top-flow strike and whether its
// independently-chosen pick happens to coincide with it (`topFlowWasPicked`), but it NEVER selects a
// strike BECAUSE flow is there. The pick is byte-identical whether or not `topFlowStrike` is supplied
// (proven by test). Flow provenance is evidence for the desk, never a thumb on the scale.
//
// CALIBRATION-FIRST: this PR gates ONLY on mechanical tradeability (liquidity / delta-band / expiry).
// The rank WEIGHTS below are evidence-only — `SWING_CONTRACT_RANK_GRADUATED = false` — until a graded
// bucket earns them through the ladder. See docs/audit/SWING-ENGINE.md §3.1 / §4 PR-4.

import {
  calendarDte,
  clearsLiquidity,
  type ChainContract,
  type LiquidityGate,
  type PlayDirection,
} from "../horizon-fanout";
import { SWING_SUB_LANES, type SwingSubLane } from "./taxonomy";
import type { OptionSnapshot } from "../providers/options-snapshot";

/**
 * The rank-weight blend is EVIDENCE-ONLY until its own graded bucket graduates it (calibration ladder:
 * n≥10, delta≥15pt). Mechanical eligibility (liquidity / delta-band / expiry) DOES gate; the score that
 * orders the eligible set does not size or gate real risk yet. Kept exported so the calibration wrapper
 * (PR-16 `analyzeContractRankCalibration`) can flip it.
 */
export const SWING_CONTRACT_RANK_GRADUATED = false;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const isNum = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** Spread as a fraction of mid; +Infinity when unpriceable (so it sorts last on the spread tie-break). */
function spreadPctOf(c: ChainContract): number {
  if (!isNum(c.bid) || !isNum(c.ask) || !isNum(c.mid) || c.mid <= 0) return Infinity;
  return (c.ask - c.bid) / c.mid;
}

/** min(bidSize, askSize) — the depth you can actually transact against; null when neither present. */
function quoteSizeOf(c: ChainContract): number | null {
  const b = isNum(c.bidSize) ? c.bidSize : null;
  const a = isNum(c.askSize) ? c.askSize : null;
  if (b == null && a == null) return null;
  if (b == null) return a;
  if (a == null) return b;
  return Math.min(a, b);
}

// ── tradability (0–1): can I get IN and OUT cleanly? ────────────────────────────────────────────────
// A weighted blend over the PRESENT components, renormalized — so missing size/volume degrades
// gracefully to a spread+OI read (the two components the liquidity gate guarantees) rather than
// scoring a fine contract low merely because the provider omitted a depth field. NEVER throws.
const SIZE_SATURATE = 50; // contracts of resting size at which quote depth reads "full"
const OI_SATURATE = 3_000; // open interest at which standing depth reads "full"
const VOL_SATURATE = 500; // day volume at which flow depth reads "full"

export function swingContractTradability(c: ChainContract, gate: LiquidityGate): number {
  const parts: Array<{ w: number; v: number }> = [];

  // Spread tightness — always present for a liquidity-cleared contract. 0 spread → 1, gate-max → 0.
  const sp = spreadPctOf(c);
  const spreadScore = sp === Infinity || gate.maxSpreadPct <= 0 ? 0 : clamp01(1 - sp / gate.maxSpreadPct);
  parts.push({ w: 0.4, v: spreadScore });

  // Open interest — always present (>=0). Standing depth you can lean on weeks out.
  parts.push({ w: 0.3, v: clamp01((c.openInterest || 0) / OI_SATURATE) });

  // Quote size — present only when the provider gave bid/ask sizes; else dropped (renormalized away).
  const qs = quoteSizeOf(c);
  if (qs != null) parts.push({ w: 0.15, v: clamp01(qs / SIZE_SATURATE) });

  // Day volume — present only when supplied; else dropped.
  if (isNum(c.dayVolume)) parts.push({ w: 0.15, v: clamp01(c.dayVolume / VOL_SATURATE) });

  const wsum = parts.reduce((s, p) => s + p.w, 0);
  if (wsum <= 0) return 0;
  return clamp01(parts.reduce((s, p) => s + p.w * p.v, 0) / wsum);
}

// ── thesisFit (0–1): is this the RIGHT instrument for a multi-session directional thesis? ────────────
/**
 * Breakeven headroom = how far (fraction of spot) the underlying must move by expiry just to break even.
 *   LONG call:  breakeven = strike + premium/share  → move = (breakeven − spot) / spot
 *   SHORT put:  breakeven = strike − premium/share  → move = (spot − breakeven) / spot
 * A higher-delta, nearer-the-money contract has a smaller premium AND a strike closer to spot, so it
 * needs a SMALLER move to profit — which is exactly why the 0.60Δ directional stance beats a cheap
 * 0.30Δ lotto for a swing thesis (SEV-4/FM#5). Returns the required move as a non-negative fraction, or
 * null when it can't be computed (no mid / no spot). Negative headroom (already ITM past breakeven) → 0.
 */
export function breakevenMovePct(
  c: ChainContract,
  direction: PlayDirection,
  underlyingPx: number,
): number | null {
  if (!isNum(c.mid) || c.mid <= 0 || !isNum(underlyingPx) || underlyingPx <= 0) return null;
  const breakeven = direction === "LONG" ? c.strike + c.mid : c.strike - c.mid;
  const move = direction === "LONG" ? (breakeven - underlyingPx) / underlyingPx : (underlyingPx - breakeven) / underlyingPx;
  return Math.max(0, move);
}

/** Headroom fraction at which the breakeven read saturates to "poor" (≈8% required move = no headroom). */
const BREAKEVEN_SATURATE = 0.08;

export function swingContractThesisFit(
  c: ChainContract,
  subLane: SwingSubLane,
  direction: PlayDirection,
  underlyingPx: number,
): number {
  const spec = SWING_SUB_LANES[subLane];
  const [bandLo, bandHi] = spec.contract.deltaBand;
  const target = spec.contract.targetDelta;
  const parts: Array<{ w: number; v: number }> = [];

  // Delta closeness to the sub-lane target, scaled by the band's half-width so "closeness" is measured
  // in units of the lane's own tolerance. Null delta → neutral (0.5): we can't measure fit but must not
  // throw or zero it out (the delta-closest fallback in the ranker handles selection).
  const halfSpan = Math.max(target - bandLo, bandHi - target, 1e-6);
  const deltaClose = isNum(c.delta) ? clamp01(1 - Math.abs(c.delta - target) / halfSpan) : 0.5;
  parts.push({ w: 0.4, v: deltaClose });

  // Breakeven headroom — the SEV-4/FM#5 core: less required move = more fit. Null → neutral 0.5.
  const move = breakevenMovePct(c, direction, underlyingPx);
  const beScore = move == null ? 0.5 : clamp01(1 - move / BREAKEVEN_SATURATE);
  parts.push({ w: 0.4, v: beScore });

  // DTE-fit inside the lane: peak in the middle of the window, taper toward the edges (an 8-DTE contract
  // in the 8–21 STANDARD lane is fine but a mid-window one is the cleanest structural fit).
  const mid = (spec.dteMin + spec.dteMax) / 2;
  const halfWin = Math.max((spec.dteMax - spec.dteMin) / 2, 1e-6);
  const dteFit = clamp01(1 - Math.abs(c.dte - mid) / halfWin);
  parts.push({ w: 0.2, v: dteFit });

  const wsum = parts.reduce((s, p) => s + p.w, 0);
  return clamp01(parts.reduce((s, p) => s + p.w * p.v, 0) / wsum);
}

export interface RankedSwingContract {
  contract: ChainContract;
  tradability: number;
  thesisFit: number;
  /** tradability × thesisFit — the ordering key. */
  score: number;
  reason: string;
}

export interface SwingContractRanking {
  /** The single best contract for the sub-lane, or null when nothing is mechanically eligible. */
  pick: ChainContract | null;
  /** All eligible contracts, scored, best-first. */
  ranked: RankedSwingContract[];
  /** The top-flow strike passed in (provenance only) — null when none supplied. */
  topFlowStrike: number | null;
  /** True iff the INDEPENDENTLY-chosen pick's strike equals `topFlowStrike`. Never influences the pick. */
  topFlowWasPicked: boolean;
  reason: string;
}

/**
 * Rank a candidate's full option chain for one sub-lane + direction and return the single best pick.
 *
 * Eligibility (mechanical, DOES gate): right option type for the direction, DTE inside the sub-lane
 * window, clears the sub-lane liquidity gate. Then delta-band matching with graceful degradation:
 *   1. contracts with |delta| inside the sub-lane band → the normal pool;
 *   2. if none in band but some have a delta → the delta-closest pool (band too tight for this chain);
 *   3. if none have a delta at all → rank the liquidity-cleared pool on tradability alone (thesisFit's
 *      delta term goes neutral). This is the "null greeks degrade to delta-closest without throwing" path.
 *
 * `opts.topFlowStrike` is recorded for provenance ONLY — it is read AFTER the pick is chosen and never
 * enters scoring or tie-breaks.
 */
export function rankSwingContracts(
  contracts: ChainContract[],
  subLane: SwingSubLane,
  direction: PlayDirection,
  underlyingPx: number,
  opts?: { topFlowStrike?: number | null },
): SwingContractRanking {
  const spec = SWING_SUB_LANES[subLane];
  const gate = spec.liquidity;
  const [bandLo, bandHi] = spec.contract.deltaBand;
  const right: "C" | "P" = direction === "LONG" ? "C" : "P";
  const topFlowStrike = isNum(opts?.topFlowStrike) ? (opts!.topFlowStrike as number) : null;

  const emptyResult = (reason: string): SwingContractRanking => ({
    pick: null,
    ranked: [],
    topFlowStrike,
    topFlowWasPicked: false,
    reason,
  });

  const inWindow = contracts.filter(
    (c) => c.right === right && c.dte >= spec.dteMin && c.dte <= spec.dteMax,
  );
  if (inWindow.length === 0) {
    return emptyResult(`no ${right} contract in ${spec.dteMin}-${spec.dteMax} DTE`);
  }
  const liquid = inWindow.filter((c) => clearsLiquidity(c, gate));
  if (liquid.length === 0) {
    return emptyResult(`${inWindow.length} in window, none clear the ${subLane} liquidity gate`);
  }

  // Delta-band matching with graceful degradation (see doc-comment).
  const withDelta = liquid.filter((c) => isNum(c.delta));
  const inBand = withDelta.filter((c) => (c.delta as number) >= bandLo && (c.delta as number) <= bandHi);
  let pool: ChainContract[];
  let poolNote: string;
  if (inBand.length > 0) {
    pool = inBand;
    poolNote = `${inBand.length} in Δ[${bandLo},${bandHi}]`;
  } else if (withDelta.length > 0) {
    // Band empty → delta-closest fallback: keep the delta-bearing set and let thesisFit's delta-closeness
    // term rank them toward the target. (Degraded: the ideal band had no contract this chain.)
    pool = withDelta;
    poolNote = `0 in band; delta-closest over ${withDelta.length}`;
  } else {
    // No greeks at all → rank on tradability (thesisFit delta term neutralizes). Never throws.
    pool = liquid;
    poolNote = `no greeks; tradability-only over ${liquid.length}`;
  }

  const ranked: RankedSwingContract[] = pool
    .map((c) => {
      const tradability = swingContractTradability(c, gate);
      const thesisFit = swingContractThesisFit(c, subLane, direction, underlyingPx);
      const move = breakevenMovePct(c, direction, underlyingPx);
      return {
        contract: c,
        tradability,
        thesisFit,
        score: tradability * thesisFit,
        reason:
          `${c.right} ${c.strike} exp ${c.expiry} (${c.dte}DTE, Δ${isNum(c.delta) ? c.delta.toFixed(2) : "—"}, ` +
          `OI ${c.openInterest}, BE ${move == null ? "—" : (move * 100).toFixed(1) + "%"}) ` +
          `trad ${tradability.toFixed(2)}×fit ${thesisFit.toFixed(2)}=${(tradability * thesisFit).toFixed(3)}`,
      };
    })
    // Order: highest score first; tie-break tighter spread → bigger quote size → higher OI. NONE of these
    // reference the flow strike — the pick is chosen purely on tradability×fit + mechanical tie-breaks.
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const sa = spreadPctOf(a.contract);
      const sb = spreadPctOf(b.contract);
      if (sa !== sb) return sa - sb;
      const qa = quoteSizeOf(a.contract) ?? 0;
      const qb = quoteSizeOf(b.contract) ?? 0;
      if (qa !== qb) return qb - qa;
      return b.contract.openInterest - a.contract.openInterest;
    });

  const pick = ranked[0]?.contract ?? null;
  // Provenance ONLY — computed AFTER the pick; the pick above never saw topFlowStrike.
  const topFlowWasPicked = pick != null && topFlowStrike != null && pick.strike === topFlowStrike;

  return {
    pick,
    ranked,
    topFlowStrike,
    topFlowWasPicked,
    reason: pick
      ? `${poolNote} → pick ${pick.right} ${pick.strike} @ ${ranked[0].score.toFixed(3)}` +
        (topFlowStrike != null ? ` (flow strike ${topFlowStrike}${topFlowWasPicked ? " = pick" : " ≠ pick"})` : "")
      : poolNote,
  };
}

// ── OptionSnapshot → ChainContract mapper ───────────────────────────────────────────────────────────
/**
 * Map ONE already-fetched unified `OptionSnapshot` into the `ChainContract` shape the ranker consumes,
 * or null to SKIP it. This is the ONLY bridge from the live provider into the pure ranker — it maps the
 * ALREADY-fetched fields (greeks, iv, oi, bid/ask, and the PR-4 additions bidSize/askSize/dayVolume from
 * last_quote.bid_size / last_quote.ask_size / session.volume) and computes calendar DTE + mid. It NEVER
 * fabricates: a snapshot missing ticker/strike/expiry/type is skipped; absent prices/greeks stay null.
 * `delta` is stored as an absolute magnitude to match ChainContract's convention (calls positive, puts'
 * magnitude), so a SHORT (put) chain band-matches the same |delta| band.
 */
export function chainContractFromSnapshot(
  snap: OptionSnapshot,
  underlyingTicker: string,
  asOfYmd: string,
): ChainContract | null {
  if (!snap || !snap.expiry || snap.optionType == null || !isNum(snap.strike) || snap.strike <= 0) {
    return null;
  }
  const dte = calendarDte(asOfYmd, snap.expiry);
  if (!Number.isFinite(dte) || dte < 0) return null;

  const bid = isNum(snap.bid) ? snap.bid : null;
  const ask = isNum(snap.ask) ? snap.ask : null;
  const mid = bid != null && ask != null && ask > 0 && bid >= 0 && ask >= bid ? (bid + ask) / 2 : null;

  return {
    ticker: underlyingTicker.toUpperCase(),
    right: snap.optionType === "call" ? "C" : "P",
    expiry: snap.expiry.slice(0, 10),
    dte,
    strike: snap.strike,
    delta: isNum(snap.delta) ? Math.abs(snap.delta) : null,
    openInterest: isNum(snap.openInterest) ? Math.max(0, Math.round(snap.openInterest)) : 0,
    bid,
    ask,
    mid,
    gamma: isNum(snap.gamma) ? snap.gamma : null,
    theta: isNum(snap.theta) ? snap.theta : null,
    vega: isNum(snap.vega) ? snap.vega : null,
    iv: isNum(snap.iv) ? snap.iv : null,
    bidSize: isNum(snap.bidSize) ? snap.bidSize : null,
    askSize: isNum(snap.askSize) ? snap.askSize : null,
    dayVolume: isNum(snap.dayVolume) ? snap.dayVolume : null,
  };
}
