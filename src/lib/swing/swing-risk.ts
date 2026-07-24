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

/** Position-scaled greeks (per-contract × contracts × multiplier, signed by direction). Each null when its input was. */
export interface SwingGreekRisk {
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
}

export interface SwingRisk {
  /** Net position greeks (share/greek-equivalent), signed: LONG = +, SHORT = − the per-contract greek. */
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
 * sub-field (never 0) and marks the position `partial`, listing the input in `missing`. Direction signs the
 * greeks — a SHORT option position carries the negated per-contract greek.
 */
export function computeSwingRisk(position: SwingRiskPosition): SwingRisk {
  const mult = isFin(position.contractMultiplier) ? position.contractMultiplier : 100;
  const qty = isFin(position.contracts) ? position.contracts : 0;
  const sign = position.direction === "LONG" ? 1 : -1;
  const missing: string[] = [];

  const g = position.greeks ?? { delta: null, gamma: null, theta: null, vega: null };
  const scale = (v: number | null, name: string): number | null => {
    if (!isFin(v)) {
      missing.push(`greeks.${name}`);
      return null;
    }
    return v * qty * mult * sign;
  };

  const greekRisk: SwingGreekRisk = {
    delta: scale(g.delta, "delta"),
    gamma: scale(g.gamma, "gamma"),
    theta: scale(g.theta, "theta"),
    vega: scale(g.vega, "vega"),
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
