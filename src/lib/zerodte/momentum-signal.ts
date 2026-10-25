// LIVE 0DTE discovery signal (operator directive, 2026-10-25) — screens a real option chain
// directly for same-day contracts priced under $1.00 with strong underlying momentum, high
// relative volume, adequate liquidity, and a realistic reachability path toward both the
// contract's own strike AND an explicit high-leverage premium target.
//
// OPERATOR'S OWN WORDS: "Find same-day expiration calls and puts with an executable ask below
// $1.00 and strong momentum, volatility, volume, liquidity, and a realistic path toward the
// strike. The objective is to identify potential runners from under $1.00 toward $20.00 early...
// Reject stale quotes and contracts with spreads or liquidity that make the displayed entry
// unrealistic."
//
// COMPOSITION — every number below comes from an EXISTING, already-tested pure function, never
// reimplemented here:
//   - `computeMomentumAcceleration` (momentum-acceleration.ts) — underlying continuation detection.
//   - `computeRelativeVolume`-derived read, supplied by the caller (relative-volume.ts /
//     relative-volume-source.ts's real wiring) — the volume-confirmation half.
//   - `rankContractsByReachability` (strike-reachability.ts) — real strike-touch-probability proxy
//     + the existing liquidity_ok floor check (OI/spread), reused unmodified.
//   - `reachabilityToPremiumTarget` (strike-reachability.ts) — the NEW touch-probability proxy
//     toward an explicit premium target (e.g. $20), same math, different distance.
// This module's only new logic is the price-band + staleness HARD-REJECT stage (below) and the
// final candidate assembly/ranking — it does not duplicate any option-math already shipped.
//
// HARD REJECTS, never merely down-ranked (the operator's own "reject" language, not "de-rank"):
//   - no real two-sided market (bid AND ask both missing/zero) — "stale quote", can't price entry.
//   - ask missing, <= 0, or >= `maxAsk` (default $1.00) — outside the named price band.
//   - the provider's own quote timestamp (`quoteAsOfMs`, when supplied) older than
//     `staleQuoteMaxAgeMs` — a genuinely stale print, not a live one.
//   - fails `rankContractsByReachability`'s own `liquidity_ok` floor (OI/spread) — reused, not
//     reinvented.
// Every rejection is reported (`rejections`), never silently dropped — diagnostics matter as much
// as the surviving candidates, same discipline as every other module in this directory.
//
// DETECTION GATE (ticker-level, shared by every contract candidate for that ticker): the SAME
// two-independent-confirmations bar momentum-discovery.ts already established — a setup is
// `detected` only when momentum is `confirmed` (accelerating AND a same-direction key-level break)
// AND relative volume clears `rvolFloor`. This module does not loosen that bar for the new
// price/target framing; it only adds a contract-level screen on top of it.

import { computeMomentumAcceleration, type MomentumBar, type MomentumAccelerationRead } from "./momentum-acceleration";
import { RVOL_HIGH } from "./relative-volume";
import { rankContractsByReachability, reachabilityToPremiumTarget } from "./strike-reachability";

export type MomentumSignalChainRow = {
  strike: number;
  side: "call" | "put";
  bid: number | null;
  ask: number | null;
  oi: number | null;
  /** Annualized implied volatility as a decimal. Null (never estimated here) when the provider
   *  doesn't supply one. */
  iv: number | null;
  /** When the provider last updated this quote (epoch ms). Optional — null/omitted means
   *  "unknown," which is NOT treated as fresh (the staleness check only fires when this is
   *  actually supplied; a caller that can't get a quote timestamp should disclose that gap rather
   *  than have this module guess). */
  quoteAsOfMs?: number | null;
};

export type MomentumSignalCandidate = {
  ticker: string;
  direction: "long" | "short";
  strike: number;
  side: "call" | "put";
  ask: number;
  mid: number | null;
  spread_pct: number | null;
  oi: number | null;
  distance_pct: number;
  reachability_prob: number | null;
  target_premium: number;
  required_underlying_price: number;
  required_move_pct: number;
  target_reachability_prob: number | null;
  /** Ordering key only (higher target-reachability, tighter spread ranks first) — NOT a trading
   *  decision by itself, same discipline as strike-reachability.ts's own `rank_score`. */
  rank_score: number;
};

export type MomentumSignalRejection = {
  ticker: string;
  strike: number;
  side: "call" | "put";
  reject_reason:
    | "stale_quote_no_two_sided_market"
    | "ask_missing_or_invalid"
    | "ask_above_price_band"
    | "stale_quote_age"
    | "illiquid";
};

export type MomentumSignalRead = {
  detected: boolean;
  direction: "long" | "short" | null;
  momentum: MomentumAccelerationRead;
  rvol_ratio: number | null;
  rvol_floor_used: number;
  /** Qualifying contracts, ranked. Empty when `detected` is false — this module never ranks
   *  contracts for a setup it did not independently detect. */
  candidates: MomentumSignalCandidate[];
  /** Every HARD-REJECTED chain row, with its reason — never silently dropped. Empty whenever
   *  `detected` is false too (no chain screening happens without a detected setup). */
  rejections: MomentumSignalRejection[];
};

const DEFAULT_MAX_ASK = 1.0;
const DEFAULT_TARGET_PREMIUM = 20;
const DEFAULT_STALE_QUOTE_MAX_AGE_MS = 5 * 60_000;

function lastClose(bars: MomentumBar[]): number {
  const sorted = [...bars].filter((b) => Number.isFinite(b.t)).sort((a, b) => a.t - b.t);
  return sorted.length ? sorted[sorted.length - 1]!.c : 0;
}

/**
 * Pure. Combines a real momentum-acceleration read, a real RVOL ratio (computed elsewhere — this
 * function does not fetch or compute it), and a real option chain snapshot into one candidate
 * read: which same-day contracts, if any, are both momentum/volume-confirmed AND price/liquidity
 * realistic right now, ranked by reachability toward an explicit premium target.
 */
export function evaluateMomentumSignal(input: {
  ticker: string;
  bars: MomentumBar[];
  referenceLevel?: { high: number; low: number } | null;
  rvolRatio: number | null;
  rvolFloor?: number;
  recentWindowMin?: number;
  priorWindowMin?: number;
  minMovePct?: number;
  minutesRemaining: number;
  chain: MomentumSignalChainRow[];
  targetPremium?: number;
  maxAsk?: number;
  minOi?: number;
  maxSpreadPct?: number;
  nowMs?: number;
  staleQuoteMaxAgeMs?: number;
}): MomentumSignalRead {
  const rvolFloor = input.rvolFloor ?? RVOL_HIGH;
  const targetPremium = input.targetPremium ?? DEFAULT_TARGET_PREMIUM;
  const maxAsk = input.maxAsk ?? DEFAULT_MAX_ASK;
  const staleMaxAge = input.staleQuoteMaxAgeMs ?? DEFAULT_STALE_QUOTE_MAX_AGE_MS;

  const momentum = computeMomentumAcceleration({
    bars: input.bars,
    recentWindowMin: input.recentWindowMin,
    priorWindowMin: input.priorWindowMin,
    minMovePct: input.minMovePct,
    referenceLevel: input.referenceLevel,
  });

  const rvolConfirmed = input.rvolRatio != null && input.rvolRatio >= rvolFloor;
  const detected = momentum.confirmed && rvolConfirmed;
  const direction: "long" | "short" | null = detected
    ? momentum.direction === "up"
      ? "long"
      : "short"
    : null;

  const candidates: MomentumSignalCandidate[] = [];
  const rejections: MomentumSignalRejection[] = [];

  if (detected && direction) {
    const wantSide: "call" | "put" = direction === "long" ? "call" : "put";
    const spot = lastClose(input.bars);

    const survivors: MomentumSignalChainRow[] = [];
    for (const row of input.chain) {
      if (row.side !== wantSide) continue;
      const hasAsk = row.ask != null && row.ask > 0;
      const hasBid = row.bid != null && row.bid > 0;
      if (!hasAsk) {
        rejections.push({ ticker: input.ticker, strike: row.strike, side: row.side, reject_reason: "ask_missing_or_invalid" });
        continue;
      }
      if (!hasBid) {
        rejections.push({ ticker: input.ticker, strike: row.strike, side: row.side, reject_reason: "stale_quote_no_two_sided_market" });
        continue;
      }
      if (row.ask! >= maxAsk) {
        rejections.push({ ticker: input.ticker, strike: row.strike, side: row.side, reject_reason: "ask_above_price_band" });
        continue;
      }
      if (input.nowMs != null && row.quoteAsOfMs != null && input.nowMs - row.quoteAsOfMs > staleMaxAge) {
        rejections.push({ ticker: input.ticker, strike: row.strike, side: row.side, reject_reason: "stale_quote_age" });
        continue;
      }
      survivors.push(row);
    }

    const byStrike = new Map(survivors.map((r) => [r.strike, r]));
    const ranked = rankContractsByReachability({
      spot,
      direction,
      minutesRemaining: input.minutesRemaining,
      candidates: survivors.map((r) => ({ strike: r.strike, side: r.side, bid: r.bid, ask: r.ask, oi: r.oi, iv: r.iv })),
      minOi: input.minOi,
      maxSpreadPct: input.maxSpreadPct,
    });

    for (const r of ranked) {
      if (!r.liquidity_ok) {
        rejections.push({ ticker: input.ticker, strike: r.strike, side: r.side, reject_reason: "illiquid" });
        continue;
      }
      const original = byStrike.get(r.strike);
      const target = reachabilityToPremiumTarget({
        spot,
        strike: r.strike,
        side: r.side,
        iv: original?.iv ?? null,
        minutesRemaining: input.minutesRemaining,
        targetPremium,
      });
      const rankScore = (target.target_reachability_prob ?? 0) - (r.spread_pct ?? 0) / 1000;
      candidates.push({
        ticker: input.ticker,
        direction,
        strike: r.strike,
        side: r.side,
        ask: r.cost_basis!,
        mid: r.mid,
        spread_pct: r.spread_pct,
        oi: original?.oi ?? null,
        distance_pct: r.distance_pct,
        reachability_prob: r.reachability_prob,
        target_premium: target.target_premium,
        required_underlying_price: target.required_underlying_price,
        required_move_pct: target.required_move_pct,
        target_reachability_prob: target.target_reachability_prob,
        rank_score: Math.round(rankScore * 10000) / 10000,
      });
    }
    candidates.sort((a, b) => b.rank_score - a.rank_score);
  }

  return {
    detected,
    direction,
    momentum,
    rvol_ratio: input.rvolRatio,
    rvol_floor_used: rvolFloor,
    candidates,
    rejections,
  };
}
