// Night's Watch valuation: value a single saved option contract from the live
// Polygon/Massive options snapshot and derive per-position P&L / risk fields.
//
// NEVER fabricates a price. When the snapshot is unavailable or the exact
// contract can't be matched, valueContract() returns null and enrichPosition()
// sets valuation_status: 'unavailable' with all live-derived fields nulled.

import { fetchPolygonContractSnapshot } from "@/lib/providers/polygon-options-gex";
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
 * Value a single option contract from the live options snapshot.
 * mark = mid of bid/ask; falls back to last trade, then day close.
 * Returns null on any snapshot failure / no exact match (never a fabricated price).
 */
export async function valueContract(input: {
  ticker: string;
  optionType: "call" | "put";
  strike: number;
  expiry: string; // YYYY-MM-DD
}): Promise<ContractValuation | null> {
  const snap = await fetchPolygonContractSnapshot({
    underlying: input.ticker,
    optionType: input.optionType,
    strike: input.strike,
    expiry: input.expiry,
  }).catch(() => null);
  if (!snap) return null;

  const { contract, underlyingPrice } = snap;
  const bid = finiteOrNull(contract.last_quote?.bid);
  const ask = finiteOrNull(contract.last_quote?.ask);
  const lastTrade = finiteOrNull(contract.last_trade?.price);
  const dayClose = finiteOrNull(contract.day?.close);

  let mark: number | null = null;
  if (bid != null && ask != null && bid > 0 && ask > 0) {
    mark = (bid + ask) / 2;
  } else if (bid != null && bid > 0 && ask != null && ask >= 0) {
    mark = (bid + ask) / 2; // one side may be 0 (e.g. deep OTM bid)
  } else if (lastTrade != null && lastTrade > 0) {
    mark = lastTrade;
  } else if (dayClose != null && dayClose > 0) {
    mark = dayClose;
  }
  // No usable price anywhere → treat as unavailable rather than invent one.
  if (mark == null || !(mark >= 0)) return null;

  return {
    mark: Number(mark.toFixed(4)),
    bid,
    ask,
    delta: finiteOrNull(contract.greeks?.delta),
    gamma: finiteOrNull(contract.greeks?.gamma),
    theta: finiteOrNull(contract.greeks?.theta),
    iv: finiteOrNull(contract.implied_volatility),
    openInterest: finiteOrNull(contract.open_interest),
    underlyingPrice: underlyingPrice > 0 ? underlyingPrice : null,
  };
}

export type EnrichedPosition = UserPositionRow & {
  valuation_status: "live" | "unavailable";
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
 * Attach live valuation + derived fields to a stored position. A null valuation
 * yields valuation_status: 'unavailable' and null live fields; DTE / breakeven
 * (which don't need a live price) are always computed.
 */
export function enrichPosition(
  position: UserPositionRow,
  valuation: ContractValuation | null,
  now: Date = new Date()
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
      pnl_pct = Number((((unrealized_pnl) / cost) * 100).toFixed(2));
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
    valuation_status: valuation ? "live" : "unavailable",
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
