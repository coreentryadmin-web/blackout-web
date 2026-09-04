/**
 * Liquid-strike fallback at plan attach — when the primary strike fails G-9
 * (plan_illiquid / malformed quote), walk the live chain to the next-nearest
 * liquid strike before giving up. Uses breakout-source liquidityQualityScore
 * for ranking; spread is re-scored at attach via buildContractPlan.
 */
import type { ChainStrikeRow } from "@/features/nighthawk/lib/option-chain-prompt";
import { buildOcc } from "@/lib/ws/options-socket";
import { ZERODTE_MAX_DTE } from "@/lib/horizons";
import {
  calendarDteBetween,
  SETUP_MAX_ITM_PCT,
  SETUP_MAX_OTM_PCT,
} from "./board";
import {
  liquidityQualityScore,
  type BreakoutChainRow,
} from "./breakout-source";
import type { ContractPlan } from "./plan";
import { buildContractPlan, PLAN_ILLIQUID_SPREAD_PCT } from "./plan";

export type LiquidStrikeCandidate = {
  strike: number;
  expiry: string;
  dte: number;
  occ: string;
  quality: number;
  distFromPrimary: number;
};

/** Kill-switch — default ON. Set ZERODTE_LIQUID_STRIKE_FALLBACK=0 to disable. */
export function liquidStrikeFallbackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.ZERODTE_LIQUID_STRIKE_FALLBACK?.trim();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

/** Max alternate strikes to try per setup (each direction from primary, nearest first). */
export const LIQUID_STRIKE_FALLBACK_MAX_TRIES = 8;

/** True when attach should walk the chain — illiquid spread or any WS-04 quote invalidity. */
export function planNeedsLiquidityFallback(plan: ContractPlan | null | undefined): boolean {
  if (!plan) return true;
  if (plan.illiquid) return true;
  return plan.quote_invalid_reason != null;
}

function chainRowToBreakout(row: ChainStrikeRow): BreakoutChainRow {
  return {
    expiry: row.expiry,
    strike: row.strike,
    call_bid: row.call_bid,
    call_ask: row.call_ask,
    call_oi: row.call_oi,
    put_bid: row.put_bid,
    put_ask: row.put_ask,
    put_oi: row.put_oi,
  };
}

function sideHasQuote(row: BreakoutChainRow, side: "call" | "put"): boolean {
  if (side === "call") {
    return (row.call_bid != null && row.call_bid > 0) || (row.call_ask != null && row.call_ask > 0);
  }
  return (row.put_bid != null && row.put_bid > 0) || (row.put_ask != null && row.put_ask > 0);
}

/** Moneyness for a candidate strike — same sign convention as board.ts refreshUnderlyingFromLiveSpot. */
export function otmPctForStrike(
  direction: "long" | "short",
  spot: number,
  strike: number
): number | null {
  if (!(spot > 0) || !(strike > 0)) return null;
  const raw = ((strike - spot) / spot) * 100;
  const otm = direction === "long" ? raw : -raw;
  return Math.round(otm * 100) / 100;
}

function strikeWithinMoneynessCaps(
  direction: "long" | "short",
  spot: number,
  strike: number
): boolean {
  const otm = otmPctForStrike(direction, spot, strike);
  if (otm == null) return false;
  if (otm < -SETUP_MAX_ITM_PCT) return false;
  if (otm > SETUP_MAX_OTM_PCT) return false;
  return true;
}

/**
 * Rank alternate strikes on the same expiry (or nearest dte inside horizon), walking away from
 * the primary strike. Pure — caller supplies live snapshots for attach-time spread scoring.
 */
export function rankLiquidStrikeAlternatives(input: {
  rows: ChainStrikeRow[];
  spot: number;
  todayYmd: string;
  ticker: string;
  expiry: string;
  primaryStrike: number;
  direction: "long" | "short";
  maxDte?: number;
  maxCandidates?: number;
}): LiquidStrikeCandidate[] {
  const {
    rows,
    spot,
    todayYmd,
    ticker,
    expiry,
    primaryStrike,
    direction,
    maxDte = ZERODTE_MAX_DTE,
    maxCandidates = LIQUID_STRIKE_FALLBACK_MAX_TRIES,
  } = input;
  if (!(spot > 0) || !(primaryStrike > 0) || rows.length === 0) return [];

  const side = direction === "long" ? "call" : "put";
  const targetExpiry = expiry.slice(0, 10);
  const primaryDte = calendarDteBetween(todayYmd, targetExpiry);
  type Cand = LiquidStrikeCandidate & { expiryDist: number };
  const cands: Cand[] = [];

  for (const row of rows) {
    const rowExpiry = row.expiry.slice(0, 10);
    const dte = calendarDteBetween(todayYmd, rowExpiry);
    if (!Number.isFinite(dte) || dte < 0 || dte > maxDte) continue;
    if (row.strike === primaryStrike && rowExpiry === targetExpiry) continue;
    const breakout = chainRowToBreakout(row);
    if (!sideHasQuote(breakout, side)) continue;
    if (!strikeWithinMoneynessCaps(direction, spot, row.strike)) continue;

    const occ = buildOcc(ticker, rowExpiry, side, row.strike);
    if (!occ) continue;

    const quality = liquidityQualityScore(breakout, side);
    const distFromPrimary = Math.abs(row.strike - primaryStrike);
    const expiryDist =
      rowExpiry === targetExpiry ? 0 : 1 + Math.abs(dte - (Number.isFinite(primaryDte) ? primaryDte : dte));

    cands.push({
      strike: row.strike,
      expiry: rowExpiry,
      dte,
      occ,
      quality,
      distFromPrimary,
      expiryDist,
    });
  }

  cands.sort((a, b) => {
    if (a.expiryDist !== b.expiryDist) return a.expiryDist - b.expiryDist;
    if (a.distFromPrimary !== b.distFromPrimary) return a.distFromPrimary - b.distFromPrimary;
    if (b.quality !== a.quality) return b.quality - a.quality;
    return a.strike - b.strike;
  });

  return cands.slice(0, maxCandidates).map(({ strike, expiry: exp, dte, occ, quality, distFromPrimary }) => ({
    strike,
    expiry: exp,
    dte,
    occ,
    quality,
    distFromPrimary,
  }));
}

export type BuildPlanForAttachInput = {
  occ: string;
  direction: "long" | "short";
  price: number | null;
  flowAvgFill: number | null;
  bid: number | null;
  ask: number | null;
  mark: number | null;
  bidSize?: number | null;
  askSize?: number | null;
  quoteAgeMs?: number | null;
  keySupports: number[];
  keyResistances: number[];
  vwap: number | null;
  chasePct?: number;
  illiquidSpreadPct?: number;
};

/** Pick the first alternate whose live snapshot clears G-9 at attach time. */
export function pickLiquidStrikePlan(
  candidates: LiquidStrikeCandidate[],
  snaps: Map<string, import("@/lib/providers/options-snapshot").OptionSnapshot>,
  buildInput: Omit<BuildPlanForAttachInput, "occ" | "bid" | "ask" | "mark" | "bidSize" | "askSize" | "quoteAgeMs"> & {
    quoteAgeMsFor: (snap: import("@/lib/providers/options-snapshot").OptionSnapshot | null | undefined) => number | undefined;
  }
): { candidate: LiquidStrikeCandidate; plan: ContractPlan } | null {
  for (const candidate of candidates) {
    const snap = snaps.get(candidate.occ) ?? null;
    if (!snap?.mark && buildInput.flowAvgFill == null) continue;
    const plan = buildContractPlan({
      occ: candidate.occ,
      direction: buildInput.direction,
      price: buildInput.price,
      flowAvgFill: buildInput.flowAvgFill,
      bid: snap?.bid ?? null,
      ask: snap?.ask ?? null,
      mark: snap?.mark ?? null,
      bidSize: snap?.bidSize ?? null,
      askSize: snap?.askSize ?? null,
      quoteAgeMs: buildInput.quoteAgeMsFor(snap),
      keySupports: buildInput.keySupports,
      keyResistances: buildInput.keyResistances,
      vwap: buildInput.vwap,
      chasePct: buildInput.chasePct,
      illiquidSpreadPct: buildInput.illiquidSpreadPct,
    });
    if (!planNeedsLiquidityFallback(plan)) {
      return { candidate, plan };
    }
  }
  return null;
}

/** Chain-level pre-filter: spread from chain bid/ask vs cap (fast reject before snapshot fetch). */
export function chainSpreadPct(
  bid: number | null,
  ask: number | null
): number | null {
  if (bid == null || ask == null || !(bid > 0) || !(ask > 0) || ask < bid) return null;
  const mid = (bid + ask) / 2;
  if (!(mid > 0)) return null;
  return Math.round(((ask - bid) / mid) * 10000) / 100;
}

export function chainPassesSpreadCap(
  row: ChainStrikeRow,
  side: "call" | "put",
  spreadCap = PLAN_ILLIQUID_SPREAD_PCT
): boolean {
  const bid = side === "call" ? row.call_bid : row.put_bid;
  const ask = side === "call" ? row.call_ask : row.put_ask;
  const pct = chainSpreadPct(bid, ask);
  if (pct == null) return true; // unknown — let attach-time scoring decide
  return pct <= spreadCap;
}
