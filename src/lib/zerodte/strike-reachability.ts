// SHADOW-ONLY signal — ranks a real option chain's candidate strikes by how likely the
// underlying is to reach each strike before expiry, net of real cost/liquidity, GIVEN a detected
// momentum setup. Pure, dependency-free; no caller in the live board/scan/cortex/commit path
// imports this file (same unwired-shadow-signal discipline as relative-volume.ts and
// momentum-acceleration.ts in this directory — see their own headers for the full rationale).
//
// WHY THIS EXISTS (2026-10-22, operator directive): "rank contracts by realistic potential to
// reach the strike and produce a profitable exit after costs... getting ITM alone doesn't
// guarantee a profitable trade." This module answers the FIRST half (reachability) honestly and
// keeps the cost/liquidity inputs as separate, first-class fields rather than folding everything
// into one opaque score — the "was this actually profitable after costs" judgment belongs to a
// real backtest (point-in-time fills, real slippage, real fees) graded against REAL outcomes, not
// something this pure ranking function should pretend to answer from a single snapshot.
//
// REACHABILITY MATH: `expected_move_pct` is the IV-implied ONE-STANDARD-DEVIATION move over the
// time remaining, time-scaled from the contract's own annualized IV the standard options-math
// way: sigma_period = iv * sqrt(minutesRemaining / (252 trading days * 390 RTH minutes/day)).
// `reachability_z` = distance-to-strike (%) / expected_move_pct — how many expected-move "sigmas"
// away the strike sits. `reachability_prob` is the classic reflection-principle TOUCH-probability
// approximation for a driftless (0-mean) diffusion: P(touch by T) ≈ 2 * (1 - Φ(z)) — more
// generous than a plain "ends beyond K" tail probability (which only asks about the FINAL price),
// because a 0DTE option is often sold once touched, not held to the literal close. This is a
// standard, well-known approximation (see any options-math reference on first-passage/touch
// probabilities for a driftless Brownian motion), not an invented formula — and it is explicitly
// a PROXY: no drift term, no smile/skew correction, and it is capped to [0, 1]. Callers must not
// treat this as a calibrated real-world probability without validating it against real outcomes
// first (see the companion real-cost backtest work this signal is built to feed).
//
// COST/LIQUIDITY ARE KEPT SEPARATE, NEVER FOLDED INTO ONE SCORE: `mid`/`spread_pct`/`cost_basis`
// are reported honestly from the candidate's own bid/ask; `liquidity_ok` is a simple floor check
// against caller-supplied OI/spread thresholds (both optional — omitted means "not constrained",
// never a guessed pass/fail). `rank_score` exists only to ORDER the output (liquid-and-reachable
// first); it is not exposed as a trading decision and should not be read as "the" edge number.

export type ChainCandidate = {
  strike: number;
  side: "call" | "put";
  bid: number | null;
  ask: number | null;
  oi: number | null;
  /** Annualized implied volatility as a decimal (e.g. 0.30 = 30%). From the provider's own
   *  greeks/IV field when available; null (never estimated here) when it isn't. */
  iv: number | null;
};

export type ReachabilityRanked = {
  strike: number;
  side: "call" | "put";
  mid: number | null;
  /** (ask - bid) / mid * 100. Null when bid or ask is missing (never guessed). */
  spread_pct: number | null;
  /** |strike - spot| / spot * 100. Always computable once spot/strike are known. */
  distance_pct: number;
  /** IV-implied 1-sigma move over the remaining time, as % of spot. Null without a real `iv`. */
  expected_move_pct: number | null;
  /** distance_pct / expected_move_pct — "how many expected moves away". Null without expected_move_pct. */
  reachability_z: number | null;
  /** 2*(1-Φ(z)), clipped to [0,1] — the touch-probability PROXY described in this file's header. */
  reachability_prob: number | null;
  /** True when within caller-supplied OI/spread floors (both optional; unconstrained -> true). */
  liquidity_ok: boolean;
  /** What a long buyer actually pays right now — the real entry cost (the ask). Null without a
   *  real ask. */
  cost_basis: number | null;
  /** Ordering key only (liquid-and-reachable ranks first) — NOT a trading decision by itself. */
  rank_score: number;
};

const MINUTES_IN_TRADING_YEAR = 252 * 390;

/** Abramowitz & Stegun 7.1.26 — standard error-function approximation, accurate to ~1.5e-7.
 *  Used to derive the standard normal CDF; a well-known, bounded-error approximation, not a
 *  fabricated shortcut. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function standardNormalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Pure. `spot`/`minutesRemaining` apply to every candidate alike; each candidate's own
 *  strike/side/bid/ask/oi/iv drives its individual read. Filters to the side matching `direction`
 *  (call for long, put for short) — a caller handing in a mixed-side chain gets back only the
 *  relevant half, never a cross-side ranking that would never actually be tradeable for this
 *  direction. Sorted by `rank_score` descending (liquid-and-reachable first); nothing is dropped
 *  for being illiquid or far — it is reported, honestly scored, and ranked lower. */
export function rankContractsByReachability(input: {
  spot: number;
  direction: "long" | "short";
  minutesRemaining: number;
  candidates: ChainCandidate[];
  minOi?: number;
  maxSpreadPct?: number;
}): ReachabilityRanked[] {
  const { spot, direction, minutesRemaining, candidates, minOi, maxSpreadPct } = input;
  const wantSide: "call" | "put" = direction === "long" ? "call" : "put";

  const out: ReachabilityRanked[] = [];
  for (const c of candidates) {
    if (c.side !== wantSide) continue;

    const mid = c.bid != null && c.ask != null ? (c.bid + c.ask) / 2 : null;
    const spreadPct = mid != null && mid > 0 && c.bid != null && c.ask != null
      ? ((c.ask - c.bid) / mid) * 100
      : null;
    const costBasis = c.ask ?? null;

    const distancePct = spot > 0 ? (Math.abs(c.strike - spot) / spot) * 100 : 0;

    let expectedMovePct: number | null = null;
    let reachabilityZ: number | null = null;
    let reachabilityProb: number | null = null;
    if (c.iv != null && c.iv > 0 && minutesRemaining > 0) {
      expectedMovePct = c.iv * Math.sqrt(minutesRemaining / MINUTES_IN_TRADING_YEAR) * 100;
      if (expectedMovePct > 0) {
        reachabilityZ = distancePct / expectedMovePct;
        const prob = 2 * (1 - standardNormalCdf(reachabilityZ));
        reachabilityProb = Math.min(1, Math.max(0, prob));
      }
    }

    const oiOk = minOi == null || c.oi == null || c.oi >= minOi;
    const spreadOk = maxSpreadPct == null || spreadPct == null || spreadPct <= maxSpreadPct;
    const liquidityOk = oiOk && spreadOk;

    const rankScore = (reachabilityProb ?? 0) - (liquidityOk ? 0 : 1);

    out.push({
      strike: c.strike,
      side: c.side,
      mid: mid != null ? Math.round(mid * 10000) / 10000 : null,
      spread_pct: spreadPct != null ? Math.round(spreadPct * 100) / 100 : null,
      distance_pct: Math.round(distancePct * 10000) / 10000,
      expected_move_pct: expectedMovePct != null ? Math.round(expectedMovePct * 10000) / 10000 : null,
      reachability_z: reachabilityZ != null ? Math.round(reachabilityZ * 10000) / 10000 : null,
      reachability_prob: reachabilityProb != null ? Math.round(reachabilityProb * 10000) / 10000 : null,
      liquidity_ok: liquidityOk,
      cost_basis: costBasis,
      rank_score: rankScore,
    });
  }

  out.sort((a, b) => b.rank_score - a.rank_score);
  return out;
}
