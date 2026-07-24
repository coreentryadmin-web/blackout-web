// src/lib/swing/swing-risk.ts — per-position greek/$ risk for the swing book (PR-6).
//
// The allocation layer caps concentration by % of the member's book, but a book of options also carries GREEK
// risk (net delta/gamma/theta/vega) and BETA-weighted directional exposure — the thing that says "how much S&P
// am I really long across every name?" This module computes that per position, position-scaled (per-contract
// greek × contracts × multiplier, signed by LONG/SHORT), plus the dollar capital at stake and the beta-weighted
// dollar delta.
//
// NULL-HONESTY (the standing law — "a null is honest, a fabricated zero is a lie"): a missing greek, spot, or
// beta is NEVER read as 0 risk. Whatever input is absent is listed in `missing` and the position is flagged
// `partial:true`, so a downstream budget never sums a hollow risk number into a real total. greeksMissing OR
// betaMissing (or absent spot/premium) ⇒ partial. Only the sub-fields we could actually ground carry a number;
// the rest stay null.
//
// PURE & deterministic — no IO. The beta comes from beta.ts (OLS today; `fetchNameBeta` deferred).

import type { PlayDirection } from "../horizon-fanout";

/** Per-CONTRACT greeks for the held option (each null when the feed didn't supply it — never a fabricated 0). */
export interface SwingPositionGreeks {
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
}

/** The minimum a per-position risk read needs. Greeks/spot/premium/beta are each independently null-able. */
export interface SwingRiskPosition {
  ticker: string;
  direction: PlayDirection;
  /** Number of option contracts held. */
  contracts: number;
  /** Shares per contract; defaults to 100. */
  contractMultiplier?: number;
  /** Per-contract greeks (each null when absent). */
  greeks: SwingPositionGreeks;
  /** Underlying spot — needed to turn share-delta into DOLLAR delta (and thus beta-weighted delta). */
  underlyingPrice?: number | null;
  /** Option mid price per share — the capital-at-risk basis (long option max loss = premium paid). */
  premiumPerShare?: number | null;
  /** Index beta from beta.ts (OLS). Null / betaMissing ⇒ beta-weighted delta stays null + partial. */
  beta?: number | null;
  betaMissing?: boolean;
}

/** Position-scaled greeks (per-contract × contracts × multiplier). DELTA is direction-signed; γ/θ/ν keep their
 * natural long-option sign (see SwingRisk.greekRisk). Each null when its input was. */
export interface SwingGreekRisk {
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
}

export interface SwingRisk {
  /**
   * Net position greeks (share/greek-equivalent).
   * - DELTA is signed by trade DIRECTION: delta is stored as a magnitude, so LONG → +|Δ|, SHORT → −|Δ| yields the
   *   net DIRECTIONAL delta (SHORT here = buying PUTS, a directional-down bet).
   * - GAMMA / THETA / VEGA are DIRECTION-INVARIANT for bought premium: in this engine every position is LONG the
   *   option (LONG = long calls, SHORT = long puts), and a long option carries +γ / −θ / +ν regardless of whether
   *   it's a call or a put. So they keep their natural long-option sign and are NOT flipped by direction. Flipping
   *   them (the old bug) inverted γ/θ/ν for SHORT, e.g. netting one long call + one long put to θ=0 instead of the
   *   real θ=−0.10 (both bleed).
   * NOTE for a future SHORT-PREMIUM (selling) lane: sign γ/θ/ν by OPTION POSITION (long vs short the contract),
   * not by trade direction — a sold option is the sign flip, not a bought put.
   */
  greekRisk: SwingGreekRisk;
  /** Capital at stake in dollars = |premiumPerShare| × multiplier × contracts. Null when premium absent. */
  dollarRisk: number | null;
  /** Beta-weighted DOLLAR delta = (delta·contracts·mult·sign·spot) × beta. Null when delta/spot/beta absent. */
  betaWeightedDelta: number | null;
  /** True when ANY needed input was missing (greeksMissing / betaMissing / absent spot / absent premium). */
  partial: boolean;
  /** The exact inputs that were absent — so a budget can see WHAT it couldn't price, not a silent 0. */
  missing: string[];
}

const isFin = (x: number | null | undefined): x is number => x != null && Number.isFinite(x);

/**
 * Compute the per-position greek/$ risk. Every output is null-propagating: a missing input yields a null
 * sub-field (never 0) and marks the position `partial`, listing the input in `missing`. Direction signs DELTA
 * only (net directional delta); γ/θ/ν are direction-invariant for bought premium — see `SwingRisk.greekRisk`.
 */
export function computeSwingRisk(position: SwingRiskPosition): SwingRisk {
  const mult = isFin(position.contractMultiplier) ? position.contractMultiplier : 100;
  const qty = isFin(position.contracts) ? position.contracts : 0;
  // Direction sign applies to DELTA only. SHORT = buying puts (long premium), so γ/θ/ν do NOT flip with it.
  const sign = position.direction === "LONG" ? 1 : -1;
  const missing: string[] = [];

  const g = position.greeks ?? { delta: null, gamma: null, theta: null, vega: null };
  // directionSign: apply the LONG/SHORT sign (delta) or leave the greek at its natural long-option sign (γ/θ/ν).
  const scale = (v: number | null, name: string, directionSign: 1 | -1): number | null => {
    if (!isFin(v)) {
      missing.push(`greeks.${name}`);
      return null;
    }
    return v * qty * mult * directionSign;
  };

  const greekRisk: SwingGreekRisk = {
    delta: scale(g.delta, "delta", sign),
    gamma: scale(g.gamma, "gamma", 1),
    theta: scale(g.theta, "theta", 1),
    vega: scale(g.vega, "vega", 1),
  };

  // Dollar capital at risk — the premium notional. Magnitude (unsigned): it's capital deployed, not a P&L sign.
  let dollarRisk: number | null = null;
  if (isFin(position.premiumPerShare)) {
    dollarRisk = Math.abs(position.premiumPerShare) * mult * qty;
  } else {
    missing.push("premiumPerShare");
  }

  // Beta-weighted DOLLAR delta: convert share-delta → dollar-delta (needs spot), then scale by index beta.
  const spot = position.underlyingPrice;
  if (!isFin(spot)) missing.push("underlyingPrice");
  const betaMissing = position.betaMissing === true || !isFin(position.beta);
  if (betaMissing) missing.push("beta");

  let betaWeightedDelta: number | null = null;
  if (isFin(g.delta) && isFin(spot) && !betaMissing) {
    const dollarDelta = g.delta * qty * mult * sign * spot;
    betaWeightedDelta = dollarDelta * (position.beta as number);
  }

  return {
    greekRisk,
    dollarRisk,
    betaWeightedDelta,
    partial: missing.length > 0,
    missing,
  };
}
