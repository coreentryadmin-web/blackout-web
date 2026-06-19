import {
  CANDIDATE_MIN_BASELINE_PREMIUM,
  CANDIDATE_PREMIUM_SLOTS,
  CANDIDATE_UNUSUAL_SLOTS,
  CANDIDATE_UNUSUALNESS_LOOKBACK_DAYS,
  INDEX_SET,
} from "./constants";
import { dbConfigured, fetchTickersAvgDailyPremium } from "@/lib/db";
import { fetchTickersFlowStreaks } from "./flow-streak";

function safeFloat(v: unknown): number {
  const n = Number(String(v ?? 0).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function flowPrintKey(row: Record<string, unknown>): string {
  const strike = safeFloat(row.strike ?? row.price);
  const expiry = String(row.expiry ?? row.expiration ?? "").slice(0, 10);
  return `${strike}|${expiry}`;
}

function spreadMultiplier(distinctStrikes: number): number {
  if (distinctStrikes <= 2) return 0.7;
  if (distinctStrikes >= 4) return 1.2;
  return 1;
}

function streakMultiplier(streakDays: number): number {
  if (streakDays >= 5) return 1.7;
  if (streakDays >= 3) return 1.4;
  return 1;
}

function unusualnessMultiplier(ratio: number): number {
  return clamp(ratio, 0.5, 3);
}

type TickerAggregate = {
  ticker: string;
  rawPremium: number;
  baseScore: number;
  distinctPrints: Set<string>;
};

function aggregateTickerFlows(
  stockFlows: Record<string, unknown>[],
  hotChains: Record<string, unknown>[],
  opts: {
    sweepBonus: number;
    minLiquidity: number;
    watchSet: Set<string> | null;
  }
): Map<string, TickerAggregate> {
  const { sweepBonus, minLiquidity, watchSet } = opts;
  const byTicker = new Map<string, TickerAggregate>();

  const touch = (ticker: string): TickerAggregate => {
    const cur = byTicker.get(ticker);
    if (cur) return cur;
    const next: TickerAggregate = { ticker, rawPremium: 0, baseScore: 0, distinctPrints: new Set() };
    byTicker.set(ticker, next);
    return next;
  };

  for (const r of stockFlows) {
    const ticker = String(r.ticker ?? "").toUpperCase();
    if (!ticker || INDEX_SET.has(ticker)) continue;
    if (watchSet && !watchSet.has(ticker)) continue;

    const prem = safeFloat(r.total_premium ?? r.premium);
    if (prem < minLiquidity) continue;

    let bonus = r.has_sweep ? sweepBonus : 1;
    if (r.all_opening_trades) bonus *= 1.3;

    const agg = touch(ticker);
    agg.rawPremium += prem;
    agg.baseScore += prem * bonus;
    const key = flowPrintKey(r);
    if (key !== "0|") agg.distinctPrints.add(key);
  }

  for (const r of hotChains) {
    const ticker = String(r.ticker ?? r.symbol ?? "").toUpperCase();
    if (!ticker || INDEX_SET.has(ticker)) continue;
    if (watchSet && !watchSet.has(ticker)) continue;

    const prem = safeFloat(r.total_premium ?? r.premium);
    if (prem < minLiquidity) continue;

    const agg = touch(ticker);
    agg.rawPremium += prem;
    agg.baseScore += prem * 0.5;
  }

  if (watchSet && byTicker.size === 0) {
    for (const ticker of Array.from(watchSet)) {
      if (!INDEX_SET.has(ticker)) {
        byTicker.set(ticker, { ticker, rawPremium: 0, baseScore: 1, distinctPrints: new Set() });
      }
    }
  }

  return byTicker;
}

export type CandidateSelectionRow = {
  ticker: string;
  raw_premium: number;
  base_score: number;
  unusualness: number;
  weighted_score: number;
  streak_days: number;
  distinct_prints: number;
};

function mergeCandidateSlots(
  premiumRanked: CandidateSelectionRow[],
  unusualRanked: CandidateSelectionRow[],
  maxTickers: number
): string[] {
  const premiumSlots = Math.min(CANDIDATE_PREMIUM_SLOTS, maxTickers);
  const unusualSlots = Math.min(CANDIDATE_UNUSUAL_SLOTS, Math.max(0, maxTickers - premiumSlots));
  const picked = new Set<string>();
  const out: string[] = [];

  for (const row of premiumRanked) {
    if (out.length >= premiumSlots) break;
    if (picked.has(row.ticker)) continue;
    picked.add(row.ticker);
    out.push(row.ticker);
  }

  for (const row of unusualRanked) {
    if (out.length >= premiumSlots + unusualSlots || out.length >= maxTickers) break;
    if (picked.has(row.ticker)) continue;
    picked.add(row.ticker);
    out.push(row.ticker);
  }

  const allRanked = [...premiumRanked].sort((a, b) => b.weighted_score - a.weighted_score);
  for (const row of allRanked) {
    if (out.length >= maxTickers) break;
    if (picked.has(row.ticker)) continue;
    picked.add(row.ticker);
    out.push(row.ticker);
  }

  return out;
}

/** Premium-relative candidate gate — surfaces unusual mid-cap flow over routine mega-cap tape. */
export async function extractCandidateTickers(
  stockFlows: Record<string, unknown>[],
  hotChains: Record<string, unknown>[],
  maxTickers = 20,
  opts?: {
    sweepBonus?: number;
    minLiquidity?: number;
    watchlist?: string[];
  }
): Promise<string[]> {
  const sweepBonus = opts?.sweepBonus ?? 1.5;
  const minLiquidity = opts?.minLiquidity ?? 0;
  const watchSet =
    opts?.watchlist && opts.watchlist.length
      ? new Set(opts.watchlist.map((t) => t.toUpperCase()))
      : null;

  const aggregates = aggregateTickerFlows(stockFlows, hotChains, { sweepBonus, minLiquidity, watchSet });
  if (!aggregates.size) return [];

  const tickers = Array.from(aggregates.keys());
  let avgPremiums: Record<string, number> = {};
  let streaks: Record<string, { streak_days: number }> = {};

  if (dbConfigured()) {
    [avgPremiums, streaks] = await Promise.all([
      fetchTickersAvgDailyPremium(tickers, CANDIDATE_UNUSUALNESS_LOOKBACK_DAYS),
      fetchTickersFlowStreaks(tickers),
    ]);
  }

  const rows: CandidateSelectionRow[] = [];

  for (const agg of Array.from(aggregates.values())) {
    const baseline = Math.max(
      avgPremiums[agg.ticker] ?? 0,
      CANDIDATE_MIN_BASELINE_PREMIUM
    );
    const unusualness = agg.rawPremium > 0 ? agg.rawPremium / baseline : 0;
    const spreadMult = spreadMultiplier(agg.distinctPrints.size);
    const streakMult = streakMultiplier(streaks[agg.ticker]?.streak_days ?? 0);
    const baseScore = agg.baseScore * spreadMult * streakMult;
    const weightedScore = baseScore * unusualnessMultiplier(unusualness);

    rows.push({
      ticker: agg.ticker,
      raw_premium: agg.rawPremium,
      base_score: baseScore,
      unusualness,
      weighted_score: weightedScore,
      streak_days: streaks[agg.ticker]?.streak_days ?? 0,
      distinct_prints: agg.distinctPrints.size,
    });
  }

  const premiumRanked = [...rows].sort((a, b) => b.weighted_score - a.weighted_score);
  const unusualRanked = [...rows].sort((a, b) => b.unusualness - a.unusualness);

  return mergeCandidateSlots(premiumRanked, unusualRanked, maxTickers);
}
