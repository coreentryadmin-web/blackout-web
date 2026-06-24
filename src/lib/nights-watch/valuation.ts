// Night's Watch valuation — PURE functions over an already-fetched options chain.
// Upstream fetching + caching live in lib/nights-watch/chain-cache.ts; this file
// never touches the network, so it can never be the per-user upstream-call hot path.
//
// NEVER fabricates a price: when no usable price exists on the matched contract,
// valuationFromContract() returns null and enrichPosition() reports 'unavailable'.

import type { ChainContract } from "@/lib/providers/polygon-options-gex";
import { todayEt } from "@/lib/et-date";
import type { UserPositionRow } from "@/lib/db";

export type ContractValuation = {
  mark: number;
  bid: number | null;
  ask: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  iv: number | null;
  openInterest: number | null;
  underlyingPrice: number | null;
};

function finiteOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract mark + greeks from a chain contract already matched by chain-cache.
 * mark = mid of bid/ask; falls back to last trade, then day close.
 * Returns null when no usable price exists (never a fabricated value).
 */
export function valuationFromContract(
  contract: ChainContract,
  spot: number
): ContractValuation | null {
  const bid = finiteOrNull(contract.last_quote?.bid);
  const ask = finiteOrNull(contract.last_quote?.ask);
  const lastTrade = finiteOrNull(contract.last_trade?.price);
  const dayClose = finiteOrNull(contract.day?.close);

  let mark: number | null = null;
  if (bid != null && ask != null && ask > 0 && bid >= 0) {
    mark = (bid + ask) / 2; // bid may be 0 for deep-OTM; ask>0 keeps it a real quote
  } else if (lastTrade != null && lastTrade > 0) {
    mark = lastTrade;
  } else if (dayClose != null && dayClose > 0) {
    mark = dayClose;
  }
  if (mark == null || !(mark >= 0)) return null;

  const up = finiteOrNull(contract.underlying_asset?.price) ?? (spot > 0 ? spot : null);

  return {
    mark: Number(mark.toFixed(4)),
    bid,
    ask,
    delta: finiteOrNull(contract.greeks?.delta),
    gamma: finiteOrNull(contract.greeks?.gamma),
    theta: finiteOrNull(contract.greeks?.theta),
    iv: finiteOrNull(contract.implied_volatility),
    openInterest: finiteOrNull(contract.open_interest),
    underlyingPrice: up != null && up > 0 ? up : null,
  };
}

export type ValuationStatus = "live" | "unavailable" | "pending";

export type EnrichedPosition = UserPositionRow & {
  valuation_status: ValuationStatus;
  valuation: ContractValuation | null;
  current_value: number | null;
  unrealized_pnl: number | null;
  pnl_pct: number | null;
  dte: number;
  breakeven: number | null;
  pct_to_breakeven: number | null;
  distance_to_strike_pct: number | null;
};

/** Calendar days to expiry, measured against the ET session date. Clamped at >= 0. */
export function daysToExpiry(expiry: string, now: Date = new Date()): number {
  const today = todayEt(now); // YYYY-MM-DD in ET
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const expMs = Date.parse(`${expiry.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(todayMs) || !Number.isFinite(expMs)) return 0;
  return Math.max(0, Math.round((expMs - todayMs) / 86_400_000));
}

/**
 * Attach valuation + derived fields to a stored position.
 * - valuation present  → 'live' with P&L/risk fields.
 * - valuation null + pending=true → 'pending' (e.g. just created; live values land on next GET).
 * - valuation null + pending=false → 'unavailable'.
 * DTE / breakeven (no live price needed) are always computed.
 */
export function enrichPosition(
  position: UserPositionRow,
  valuation: ContractValuation | null,
  now: Date = new Date(),
  pending = false
): EnrichedPosition {
  const dte = daysToExpiry(position.expiry, now);

  // Breakeven only well-defined for long single-leg calls/puts.
  let breakeven: number | null = null;
  if (position.side === "long") {
    breakeven =
      position.option_type === "call"
        ? position.strike + position.entry_premium
        : position.strike - position.entry_premium;
  }

  const sideSign = position.side === "long" ? 1 : -1;
  const multiplier = position.contracts * 100;

  let current_value: number | null = null;
  let unrealized_pnl: number | null = null;
  let pnl_pct: number | null = null;
  let pct_to_breakeven: number | null = null;
  let distance_to_strike_pct: number | null = null;

  if (valuation) {
    current_value = Number((valuation.mark * multiplier).toFixed(2));
    unrealized_pnl = Number(
      ((valuation.mark - position.entry_premium) * multiplier * sideSign).toFixed(2)
    );
    const cost = position.entry_premium * multiplier;
    if (cost > 0) {
      pnl_pct = Number(((unrealized_pnl / cost) * 100).toFixed(2));
    }
    const px = valuation.underlyingPrice;
    if (px != null && px > 0) {
      if (breakeven != null && breakeven > 0) {
        pct_to_breakeven = Number((((breakeven - px) / px) * 100).toFixed(2));
      }
      distance_to_strike_pct = Number((((position.strike - px) / px) * 100).toFixed(2));
    }
  }

  return {
    ...position,
    valuation_status: valuation ? "live" : pending ? "pending" : "unavailable",
    valuation,
    current_value,
    unrealized_pnl,
    pnl_pct,
    dte,
    breakeven,
    pct_to_breakeven,
    distance_to_strike_pct,
  };
}
