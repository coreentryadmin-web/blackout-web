/**
 * Night Hawk — horizon fan-out (remodel slice 2).
 *
 * Takes ONE candidate's full option chain (every listed expiry × strike) and produces the single best
 * tradeable contract for EACH horizon window — the mechanic that lets one whole-market mover surface as a
 * 0DTE scalp AND a Swing AND a LEAPS play at once, from the same underlying, at three different expiries.
 *
 * This module is PURE and provider-agnostic. It consumes a normalized `ChainContract[]`; the thin adapter
 * `explodeChainRows()` maps the existing `ChainStrikeRow[]` (option-chain-prompt.ts, fed by Polygon's
 * `fetchPolygonAtmChainAllExpiries`) into that shape, so wiring the live provider in the next slice is a
 * one-liner and this logic stays unit-testable with synthetic chains.
 *
 * The rule per horizon: keep only contracts whose calendar DTE is inside the lane's window
 * (src/lib/horizons.ts), of the right option type for the play direction, that clear a hard liquidity
 * gate, and whose |delta| sits in the lane's target band — then pick the one whose delta is closest to
 * the lane's target (tie-break: higher OI, then tighter spread). If nothing qualifies, the lane returns a
 * null contract with the reason it came up empty. **A lane only ever prints when a real, liquid contract
 * exists** — contract availability is what scopes each lane across the whole market, never a ticker list.
 */

import { HORIZON_ORDER, HORIZONS, type Horizon } from "./horizons.ts";

/** Trade direction for a candidate. LONG buys calls, SHORT buys puts. */
export type PlayDirection = "LONG" | "SHORT";

/** A single normalized, priced option contract (one right, one strike, one expiry). */
export interface ChainContract {
  ticker: string;
  right: "C" | "P";
  /** Expiry as YYYY-MM-DD. */
  expiry: string;
  /** Calendar days to expiry from the as-of date (>= 0). */
  dte: number;
  strike: number;
  /** Absolute delta in [0,1] (calls positive, puts' magnitude). Null when the provider omitted it. */
  delta: number | null;
  openInterest: number;
  bid: number | null;
  ask: number | null;
  /** Mid premium per share = (bid+ask)/2 when both present, else null. */
  mid: number | null;
}

/** Hard liquidity gate a contract must clear to be tradeable. */
export interface LiquidityGate {
  /** Minimum open interest. */
  minOpenInterest: number;
  /** Maximum bid/ask spread as a fraction of mid ((ask-bid)/mid). */
  maxSpreadPct: number;
  /** Maximum premium per share (cost cap) — mirrors the edition's MAX_OPTION_PREMIUM_PER_SHARE ($35). */
  maxPremiumPerShare: number;
}

export const DEFAULT_LIQUIDITY: LiquidityGate = {
  minOpenInterest: 250,
  maxSpreadPct: 0.25,
  maxPremiumPerShare: 35,
};

/** The chosen contract (or null) for one horizon, with a human reason. */
export interface HorizonPick {
  horizon: Horizon;
  contract: ChainContract | null;
  /** Why this contract was picked, or why the lane is empty. */
  reason: string;
  /** How many contracts survived the window + type + liquidity + band filters (before the final pick). */
  candidates: number;
}

/** Days between two YYYY-MM-DD dates (b - a), calendar days, UTC-anchored. */
export function calendarDte(asOfYmd: string, expiryYmd: string): number {
  const a = Date.parse(`${asOfYmd.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${expiryYmd.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.round((b - a) / 86_400_000);
}

function midOf(bid: number | null, ask: number | null): number | null {
  if (bid == null || ask == null || !Number.isFinite(bid) || !Number.isFinite(ask)) return null;
  if (bid < 0 || ask < 0 || ask < bid) return null;
  return (bid + ask) / 2;
}

/**
 * Adapter: normalized contracts for the requested play direction from the existing per-strike chain rows.
 * LONG → calls, SHORT → puts. One `ChainContract` per (strike, expiry) that carries the needed side's data.
 */
export function explodeChainRows(
  ticker: string,
  rows: Array<{
    expiry: string;
    strike: number;
    call_bid: number | null;
    call_ask: number | null;
    call_delta: number | null;
    call_oi: number;
    put_bid: number | null;
    put_ask: number | null;
    put_delta: number | null;
    put_oi: number;
  }>,
  asOfYmd: string,
  direction: PlayDirection,
): ChainContract[] {
  const right: "C" | "P" = direction === "LONG" ? "C" : "P";
  const out: ChainContract[] = [];
  for (const r of rows) {
    if (!r.expiry || !(r.strike > 0)) continue;
    const dte = calendarDte(asOfYmd, r.expiry);
    if (!Number.isFinite(dte) || dte < 0) continue;
    const bid = right === "C" ? r.call_bid : r.put_bid;
    const ask = right === "C" ? r.call_ask : r.put_ask;
    const rawDelta = right === "C" ? r.call_delta : r.put_delta;
    out.push({
      ticker: ticker.toUpperCase(),
      right,
      expiry: r.expiry.slice(0, 10),
      dte,
      strike: r.strike,
      delta: rawDelta == null || !Number.isFinite(rawDelta) ? null : Math.abs(rawDelta),
      openInterest: Math.max(0, Math.round((right === "C" ? r.call_oi : r.put_oi) ?? 0)),
      bid,
      ask,
      mid: midOf(bid, ask),
    });
  }
  return out;
}

function clearsLiquidity(c: ChainContract, gate: LiquidityGate): boolean {
  if (c.openInterest < gate.minOpenInterest) return false;
  if (c.mid == null || c.mid <= 0) return false;
  if (c.mid > gate.maxPremiumPerShare) return false;
  if (c.bid == null || c.ask == null) return false;
  const spreadPct = (c.ask - c.bid) / c.mid;
  return spreadPct <= gate.maxSpreadPct;
}

/**
 * Fan a normalized contract set out across the three horizons. Returns one pick per horizon (in
 * fast→slow order). Contracts missing a delta are ineligible for band matching (we cannot confirm the
 * lane's stance without it) but still count as "seen" for the reason string.
 */
export function fanOutContracts(
  contracts: ChainContract[],
  gate: LiquidityGate = DEFAULT_LIQUIDITY,
): HorizonPick[] {
  return HORIZON_ORDER.map((horizon) => {
    const spec = HORIZONS[horizon];
    const [bandLo, bandHi] = spec.contract.deltaBand;

    const inWindow = contracts.filter((c) => c.dte >= spec.dteMin && c.dte <= spec.dteMax);
    if (inWindow.length === 0) {
      return { horizon, contract: null, reason: `no listed expiry in ${spec.dteMin}-${spec.dteMax} DTE`, candidates: 0 };
    }
    const liquid = inWindow.filter((c) => clearsLiquidity(c, gate));
    if (liquid.length === 0) {
      return { horizon, contract: null, reason: `${inWindow.length} expiries in window, none clear the liquidity gate`, candidates: 0 };
    }
    const inBand = liquid.filter((c) => c.delta != null && c.delta >= bandLo && c.delta <= bandHi);
    if (inBand.length === 0) {
      return { horizon, contract: null, reason: `${liquid.length} liquid, none with |delta| in ${bandLo}-${bandHi}`, candidates: 0 };
    }
    // Best fit: delta closest to the lane target; tie-break higher OI, then tighter spread.
    const best = inBand.slice().sort((a, b) => {
      const da = Math.abs((a.delta as number) - spec.contract.targetDelta);
      const db = Math.abs((b.delta as number) - spec.contract.targetDelta);
      if (da !== db) return da - db;
      if (a.openInterest !== b.openInterest) return b.openInterest - a.openInterest;
      const sa = a.bid != null && a.ask != null && a.mid ? (a.ask - a.bid) / a.mid : Infinity;
      const sb = b.bid != null && b.ask != null && b.mid ? (b.ask - b.bid) / b.mid : Infinity;
      return sa - sb;
    })[0];
    return {
      horizon,
      contract: best,
      reason: `${best.right} ${best.strike} exp ${best.expiry} (${best.dte}DTE, Δ${best.delta?.toFixed(2)}, OI ${best.openInterest})`,
      candidates: inBand.length,
    };
  });
}

/** Convenience: adapt raw chain rows + fan out in one call. */
export function fanOutChain(
  ticker: string,
  rows: Parameters<typeof explodeChainRows>[1],
  asOfYmd: string,
  direction: PlayDirection,
  gate: LiquidityGate = DEFAULT_LIQUIDITY,
): HorizonPick[] {
  return fanOutContracts(explodeChainRows(ticker, rows, asOfYmd, direction), gate);
}
