// EARLY-ENTRY contract selection — the operator's $1.00-$3.00 premium band, with an explicit
// "already extended" rejection and reachability-first (never cheapness-first) ranking.
//
// OPERATOR'S OWN WORDS: "Select contracts around $1.00-$3.00 using executable ask prices and
// fresh quotes. Require reasonable spreads, liquidity, and sufficient time remaining. Never
// choose a distant strike simply because it is cheap... Rank contracts by whether the underlying
// can realistically reach and move beyond the strike before expiration. Evaluate distance to
// strike against remaining expected movement, nearby resistance/support, time remaining, and
// volatility. Reject setups where most of the likely move has already happened."
//
// COMPOSITION — reuses the EXISTING, already-tested reachability math unmodified:
//   - `rankContractsByReachability` (strike-reachability.ts) — the real touch-probability proxy
//     (distance vs IV-implied expected move) + the existing liquidity_ok floor (OI/spread).
// This module's only new logic is: the $1.00-$3.00 price-band + staleness HARD-REJECT stage, the
// "already extended" rejection (below), and final ranking that penalizes BOTH a wide spread and a
// move that has already mostly happened — reachability alone doesn't know how much of the setup's
// own anticipated move has ALREADY occurred since the coil was first detected, which is a
// genuinely different question from "how far is the strike in expected-move units right now."
//
// "ALREADY EXTENDED" — THE CONCRETE RULE: captured_fraction = 1 - (|strike - spotNow| /
// |strike - spotAtWatch|), i.e. how much of the distance that existed between the underlying and
// this strike AT THE MOMENT THE COIL WAS FIRST DETECTED has since closed. A setup whose captured
// fraction already clears `maxAlreadyExtendedFraction` (default 0.6) is hard-rejected for THAT
// strike — not because the strike itself is bad, but because most of the move this specific
// contract needed has already happened, leaving mostly decay and little real upside from here.
// `spotAtWatch` must be the WATCH-detection price (early-entry-state.ts's own
// `watch_detected_at_ms` instant), never "today's open" or some other anchor — a stale or
// mismatched anchor would silently misreport how much room is actually left.

import { rankContractsByReachability, type ChainCandidate } from "./strike-reachability";

export type EarlyEntryChainRow = {
  strike: number;
  side: "call" | "put";
  bid: number | null;
  ask: number | null;
  oi: number | null;
  iv: number | null;
  /** Provider's own quote timestamp (epoch ms), when known. Omitted/null -> the staleness check
   *  never fires (never guessed fresh OR stale without real evidence either way). */
  quoteAsOfMs?: number | null;
};

export type EarlyEntryCandidate = {
  strike: number;
  side: "call" | "put";
  ask: number;
  bid: number | null;
  mid: number | null;
  spread_pct: number | null;
  oi: number | null;
  /** The real IV this candidate's reachability math used, carried through honestly so a
   *  downstream display/estimate consumer never has to re-derive or guess it. Null exactly when
   *  the provider never supplied one (reachability_prob/expected_move_pct are then also null). */
  iv: number | null;
  distance_pct: number;
  expected_move_pct: number | null;
  reachability_prob: number | null;
  /** Fraction (can be negative — negative means the setup gained room, not lost it) of the
   *  watch-to-strike distance already closed since the coil was first detected. */
  captured_fraction: number | null;
  /** Ordering key only — NOT a trading decision by itself, same discipline as every other
   *  rank_score in this directory. */
  rank_score: number;
};

export type EarlyEntryRejectReason =
  | "ask_missing_or_invalid"
  | "stale_quote_no_two_sided_market"
  | "ask_outside_price_band"
  | "stale_quote_age"
  | "illiquid"
  | "already_extended";

export type EarlyEntryRejection = {
  strike: number;
  side: "call" | "put";
  reject_reason: EarlyEntryRejectReason;
};

const DEFAULT_MIN_ASK = 1.0;
const DEFAULT_MAX_ASK = 3.0;
const DEFAULT_MAX_SPREAD_PCT = 20;
const DEFAULT_MAX_ALREADY_EXTENDED_FRACTION = 0.6;
const DEFAULT_STALE_QUOTE_MAX_AGE_MS = 5 * 60_000;

function capturedFraction(strike: number, spotAtWatch: number, spotNow: number): number | null {
  const distanceAtWatch = Math.abs(strike - spotAtWatch);
  if (!(distanceAtWatch > 0)) return null; // no real anchor distance -> never guess
  const distanceNow = Math.abs(strike - spotNow);
  return Math.round((1 - distanceNow / distanceAtWatch) * 10000) / 10000;
}

/**
 * Pure. Hard-rejects (never down-ranks) a chain row for: no real two-sided market, a missing/
 * non-positive ask, an ask outside the $1.00-$3.00 band, a stale quote, illiquidity (reused
 * `liquidity_ok` floor), or an already-mostly-captured move. Every rejection is reported, never
 * silently dropped. Survivors are ranked reachability-first, never by raw cheapness.
 */
export function selectEarlyEntryContract(input: {
  direction: "long" | "short";
  /** The underlying price AT WATCH DETECTION — the anchor for "how much room is left." */
  spotAtWatch: number;
  /** The underlying price right now (also the reachability math's own anchor). */
  spotNow: number;
  minutesRemaining: number;
  chain: EarlyEntryChainRow[];
  minAsk?: number;
  maxAsk?: number;
  minOi?: number;
  maxSpreadPct?: number;
  maxAlreadyExtendedFraction?: number;
  nowMs?: number;
  staleQuoteMaxAgeMs?: number;
}): { candidates: EarlyEntryCandidate[]; rejections: EarlyEntryRejection[] } {
  const minAsk = input.minAsk ?? DEFAULT_MIN_ASK;
  const maxAsk = input.maxAsk ?? DEFAULT_MAX_ASK;
  const maxSpreadPct = input.maxSpreadPct ?? DEFAULT_MAX_SPREAD_PCT;
  const maxExtended = input.maxAlreadyExtendedFraction ?? DEFAULT_MAX_ALREADY_EXTENDED_FRACTION;
  const staleMaxAge = input.staleQuoteMaxAgeMs ?? DEFAULT_STALE_QUOTE_MAX_AGE_MS;
  const wantSide: "call" | "put" = input.direction === "long" ? "call" : "put";

  const rejections: EarlyEntryRejection[] = [];
  const survivors: EarlyEntryChainRow[] = [];
  for (const row of input.chain) {
    if (row.side !== wantSide) continue;
    const hasAsk = row.ask != null && row.ask > 0;
    const hasBid = row.bid != null && row.bid > 0;
    if (!hasAsk) {
      rejections.push({ strike: row.strike, side: row.side, reject_reason: "ask_missing_or_invalid" });
      continue;
    }
    if (!hasBid) {
      rejections.push({ strike: row.strike, side: row.side, reject_reason: "stale_quote_no_two_sided_market" });
      continue;
    }
    if (row.ask! < minAsk || row.ask! > maxAsk) {
      rejections.push({ strike: row.strike, side: row.side, reject_reason: "ask_outside_price_band" });
      continue;
    }
    if (input.nowMs != null && row.quoteAsOfMs != null && input.nowMs - row.quoteAsOfMs > staleMaxAge) {
      rejections.push({ strike: row.strike, side: row.side, reject_reason: "stale_quote_age" });
      continue;
    }
    survivors.push(row);
  }

  const byStrike = new Map(survivors.map((r) => [r.strike, r]));
  const ranked = rankContractsByReachability({
    spot: input.spotNow,
    direction: input.direction,
    minutesRemaining: input.minutesRemaining,
    candidates: survivors.map((r): ChainCandidate => ({ strike: r.strike, side: r.side, bid: r.bid, ask: r.ask, oi: r.oi, iv: r.iv })),
    minOi: input.minOi,
    maxSpreadPct,
  });

  const candidates: EarlyEntryCandidate[] = [];
  for (const r of ranked) {
    if (!r.liquidity_ok) {
      rejections.push({ strike: r.strike, side: r.side, reject_reason: "illiquid" });
      continue;
    }
    const captured = capturedFraction(r.strike, input.spotAtWatch, input.spotNow);
    if (captured != null && captured >= maxExtended) {
      rejections.push({ strike: r.strike, side: r.side, reject_reason: "already_extended" });
      continue;
    }
    const original = byStrike.get(r.strike);
    const rankScore =
      (r.reachability_prob ?? 0) - (r.spread_pct ?? 100) / 1000 - (captured ?? 0) / 10;
    candidates.push({
      strike: r.strike,
      side: r.side,
      ask: r.cost_basis!,
      bid: original?.bid ?? null,
      mid: r.mid,
      spread_pct: r.spread_pct,
      oi: original?.oi ?? null,
      iv: original?.iv ?? null,
      distance_pct: r.distance_pct,
      expected_move_pct: r.expected_move_pct,
      reachability_prob: r.reachability_prob,
      captured_fraction: captured,
      rank_score: Math.round(rankScore * 10000) / 10000,
    });
  }
  candidates.sort((a, b) => b.rank_score - a.rank_score);

  return { candidates, rejections };
}
