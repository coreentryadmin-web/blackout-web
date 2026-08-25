import {
  CANDIDATE_MIN_BASELINE_PREMIUM,
  CANDIDATE_MIN_UNDERLYING_PRICE,
  CANDIDATE_PREMIUM_SLOTS,
  CANDIDATE_UNUSUAL_SLOTS,
  CANDIDATE_UNUSUALNESS_LOOKBACK_DAYS,
  INDEX_SET,
  LEVERAGED_ETP_SET,
} from "./constants";
import { dbConfigured, fetchTickersAvgDailyPremium } from "@/lib/db";
import { fetchTickersFlowStreaks } from "./flow-streak";
import type { MarketWideContext } from "./market-wide";
import type { PredictionConsensusSignal } from "@/lib/providers/unusual-whales";

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

/**
 * Structural instrument filter (audit MEDIUM: none existed — a 3x leveraged ETF,
 * SPAC warrant, or unit with one unusual print became a full "stock" candidate and
 * was scored by machinery built for single names). Excludes:
 *  - index products (INDEX_SET) and leveraged/inverse ETPs + VIX wrappers,
 *  - SPAC-suffix instruments: 5-char tickers ending W/U/R (warrant/unit/right
 *    convention) and explicit ".WS"/"-WT"-style suffixes.
 */
export function isExcludedInstrument(ticker: string): boolean {
  const t = ticker.toUpperCase();
  if (INDEX_SET.has(t) || LEVERAGED_ETP_SET.has(t)) return true;
  if (/[.\-+](WS|WT|W|U|R|RT)$/.test(t)) return true;
  if (/^[A-Z]{4}[WUR]$/.test(t)) return true;
  return false;
}

type TickerAggregate = {
  ticker: string;
  rawPremium: number;
  baseScore: number;
  distinctPrints: Set<string>;
  /** Highest underlying price observed on this ticker's rows (0 = never carried). */
  maxUnderlying: number;
};

function aggregateTickerFlows(
  stockFlows: Record<string, unknown>[],
  hotChains: Record<string, unknown>[],
  opts: {
    sweepBonus: number;
    minLiquidity: number;
    watchSet: Set<string> | null;
    /** Cross-source corroboration rows (UW top-net-impact) — audit: fetched but never used. */
    topNetImpact?: Record<string, unknown>[];
  }
): Map<string, TickerAggregate> {
  const { sweepBonus, minLiquidity, watchSet, topNetImpact } = opts;
  const byTicker = new Map<string, TickerAggregate>();

  const touch = (ticker: string): TickerAggregate => {
    const cur = byTicker.get(ticker);
    if (cur) return cur;
    const next: TickerAggregate = { ticker, rawPremium: 0, baseScore: 0, distinctPrints: new Set(), maxUnderlying: 0 };
    byTicker.set(ticker, next);
    return next;
  };

  for (const r of stockFlows) {
    const ticker = String(r.ticker ?? "").toUpperCase();
    if (!ticker || isExcludedInstrument(ticker)) continue;
    if (watchSet && !watchSet.has(ticker)) continue;

    const prem = safeFloat(r.total_premium ?? r.premium);
    if (prem < minLiquidity) continue;

    let bonus = r.has_sweep ? sweepBonus : 1;
    if (r.all_opening_trades) bonus *= 1.3;

    const agg = touch(ticker);
    agg.rawPremium += prem;
    agg.baseScore += prem * bonus;
    agg.maxUnderlying = Math.max(agg.maxUnderlying, safeFloat(r.underlying_price ?? r.stock_price));
    const key = flowPrintKey(r);
    if (key !== "0|") agg.distinctPrints.add(key);
  }

  for (const r of hotChains) {
    const ticker = String(r.ticker ?? r.symbol ?? "").toUpperCase();
    if (!ticker || isExcludedInstrument(ticker)) continue;
    if (watchSet && !watchSet.has(ticker)) continue;

    const prem = safeFloat(r.total_premium ?? r.premium);
    if (prem < minLiquidity) continue;

    const agg = touch(ticker);
    agg.rawPremium += prem;
    agg.baseScore += prem * 0.5;
  }

  // Cross-source corroboration (audit HIGH: mono-source discovery): UW's top-net-impact
  // screen ("names driving net premium") was fetched by market-wide but never reached
  // discovery. Weighted 0.75 — independent-screen corroboration, below first-class flow
  // rows but above the hot-chains re-aggregation of the same tape.
  for (const r of topNetImpact ?? []) {
    const ticker = String(r.ticker ?? r.symbol ?? "").toUpperCase();
    if (!ticker || isExcludedInstrument(ticker)) continue;
    if (watchSet && !watchSet.has(ticker)) continue;

    const prem = Math.abs(safeFloat(r.net_premium ?? r.total_premium ?? r.premium));
    if (prem < minLiquidity) continue;

    const agg = touch(ticker);
    agg.rawPremium += prem;
    agg.baseScore += prem * 0.75;
  }

  if (watchSet && byTicker.size === 0) {
    for (const ticker of Array.from(watchSet)) {
      if (!isExcludedInstrument(ticker)) {
        byTicker.set(ticker, { ticker, rawPremium: 0, baseScore: 1, distinctPrints: new Set(), maxUnderlying: 0 });
      }
    }
  }

  // Penny/garbage-runner floor: only applied when a row actually carried the
  // underlying price — absence of the field must not evict legitimate names.
  for (const [ticker, agg] of Array.from(byTicker.entries())) {
    if (agg.maxUnderlying > 0 && agg.maxUnderlying < CANDIDATE_MIN_UNDERLYING_PRICE) {
      byTicker.delete(ticker);
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
    /** UW top-net-impact rows for cross-source corroboration (see aggregateTickerFlows). */
    topNetImpact?: Record<string, unknown>[];
  }
): Promise<string[]> {
  const sweepBonus = opts?.sweepBonus ?? 1.5;
  const minLiquidity = opts?.minLiquidity ?? 0;
  const watchSet =
    opts?.watchlist && opts.watchlist.length
      ? new Set(opts.watchlist.map((t) => t.toUpperCase()))
      : null;

  const aggregates = aggregateTickerFlows(stockFlows, hotChains, {
    sweepBonus,
    minLiquidity,
    watchSet,
    topNetImpact: opts?.topNetImpact,
  });
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

// ── Multi-source candidate engine ──────────────────────────────────────────────
// Six independent lanes each produce a normalized 0–max_pts score per ticker.
// Tickers appearing in multiple lanes get a corroboration bonus. The top N by
// composite score become candidates. This replaces the flow-only path for the
// edition pipeline while keeping the old function for hunt-builder.

// Rebalanced 2026-08-05 (discovery-architecture redesign): FLOW's ceiling cut from 40 to 28 —
// at 40 vs a 103-point total, flow alone could singlehandedly out-rank every technical/catalyst
// signal combined ("biggest premium today" dominating the pool per the operator's own read of the
// architecture). BREAKOUT and CATALYST raised (10→18, 10→16) so real price-action/event signals
// can out-rank a merely-large options print — flow is still the single largest lane (real,
// current-day conviction deserves real weight) but no longer close to half the total ceiling.
// New total ceiling: 28+15+12+16+8+8+18=105 (was 103) — comparable scale, redistributed weight.
const LANE_MAX_FLOW = 28;
const LANE_MAX_OI = 15;
const LANE_MAX_UNUSUAL = 12;
const LANE_MAX_CATALYST = 16;
const LANE_MAX_PREDICTIONS = 8;
const LANE_MAX_MOVERS = 8;
const LANE_MAX_BREAKOUT = 18;

type LaneEntry = { ticker: string; rawScore: number };

function normalizeToMax(entries: LaneEntry[], maxPts: number): Map<string, number> {
  const top = entries.reduce((m, e) => Math.max(m, e.rawScore), 0);
  if (top <= 0) return new Map();
  const out = new Map<string, number>();
  for (const e of entries) {
    const prev = out.get(e.ticker) ?? 0;
    out.set(e.ticker, Math.max(prev, (e.rawScore / top) * maxPts));
  }
  return out;
}

function laneFlow(ctx: MarketWideContext): Map<string, number> {
  const entries: LaneEntry[] = [];
  const seen = new Map<string, number>();

  for (const r of ctx.stock_flows) {
    const ticker = String(r.ticker ?? "").toUpperCase();
    if (!ticker || isExcludedInstrument(ticker)) continue;
    const prem = safeFloat(r.total_premium ?? r.premium);
    if (prem <= 0) continue;
    const underlying = safeFloat(r.underlying_price ?? r.stock_price);
    if (underlying > 0 && underlying < CANDIDATE_MIN_UNDERLYING_PRICE) continue;
    let bonus = r.has_sweep ? 1.5 : 1;
    if (r.all_opening_trades) bonus *= 1.3;
    seen.set(ticker, (seen.get(ticker) ?? 0) + prem * bonus);
  }

  for (const r of ctx.hot_chains) {
    const ticker = String(r.ticker ?? r.symbol ?? "").toUpperCase();
    if (!ticker || isExcludedInstrument(ticker)) continue;
    const prem = safeFloat(r.total_premium ?? r.premium);
    if (prem <= 0) continue;
    seen.set(ticker, (seen.get(ticker) ?? 0) + prem * 0.5);
  }

  for (const r of ctx.top_net_impact) {
    const ticker = String(r.ticker ?? r.symbol ?? "").toUpperCase();
    if (!ticker || isExcludedInstrument(ticker)) continue;
    const prem = Math.abs(safeFloat(r.net_premium ?? r.total_premium ?? r.premium));
    if (prem <= 0) continue;
    seen.set(ticker, (seen.get(ticker) ?? 0) + prem * 0.75);
  }

  for (const [ticker, score] of seen) entries.push({ ticker, rawScore: score });
  return normalizeToMax(entries, LANE_MAX_FLOW);
}

function laneOiChange(ctx: MarketWideContext): Map<string, number> {
  const entries: LaneEntry[] = [];
  for (const r of ctx.market_oi_change) {
    const ticker = String(r.ticker ?? r.symbol ?? "").toUpperCase();
    if (!ticker || isExcludedInstrument(ticker)) continue;
    const oiChange = Math.abs(safeFloat(r.oi_change ?? r.change ?? r.net_oi_change));
    const prem = Math.abs(safeFloat(r.total_premium ?? r.premium ?? 0));
    if (oiChange <= 0 && prem <= 0) continue;
    entries.push({ ticker, rawScore: oiChange + prem * 0.001 });
  }
  return normalizeToMax(entries, LANE_MAX_OI);
}

function laneUnusualTrades(ctx: MarketWideContext): Map<string, number> {
  const entries: LaneEntry[] = [];
  const byTicker = new Map<string, number>();
  for (const r of ctx.unusual_trades) {
    const ticker = String(r.ticker ?? r.symbol ?? "").toUpperCase();
    if (!ticker || isExcludedInstrument(ticker)) continue;
    const prem = safeFloat(r.premium ?? r.total_premium ?? r.ask ?? 0);
    const vol = safeFloat(r.volume ?? 0);
    byTicker.set(ticker, (byTicker.get(ticker) ?? 0) + Math.max(prem, vol * 0.1));
  }
  for (const [ticker, score] of byTicker) {
    if (score > 0) entries.push({ ticker, rawScore: score });
  }
  return normalizeToMax(entries, LANE_MAX_UNUSUAL);
}

function laneCatalyst(ctx: MarketWideContext): Map<string, number> {
  const entries: LaneEntry[] = [];
  const tickerRe = /\b([A-Z]{1,5})\b/g;

  for (const c of ctx.after_hours_catalysts) {
    const matches = c.title.match(tickerRe) ?? [];
    const binaryBoost = c.type === "binary" || c.type === "m&a" ? 1.5 : 1;
    for (const t of matches) {
      if (t.length < 2 || isExcludedInstrument(t) || INDEX_SET.has(t)) continue;
      if (["THE", "FOR", "AND", "CEO", "CFO", "FDA", "SEC", "IPO", "ETF", "NYSE", "EPS", "BUY", "NEW", "TOP", "LOW", "ALL", "BIG", "GET", "PUT", "SET", "NOT", "CAN", "MAY", "HAS", "ITS", "NOW", "SAY", "RUN", "CUT", "HIT", "KEY"].includes(t)) continue;
      entries.push({ ticker: t, rawScore: 6 * binaryBoost });
    }
  }

  for (const r of ctx.tomorrow_earnings) {
    const ticker = String(r.ticker ?? r.symbol ?? "").toUpperCase();
    if (!ticker || isExcludedInstrument(ticker)) continue;
    entries.push({ ticker, rawScore: 4 });
  }

  return normalizeToMax(entries, LANE_MAX_CATALYST);
}

function lanePredictions(predictions: PredictionConsensusSignal[]): Map<string, number> {
  const entries: LaneEntry[] = [];
  for (const p of predictions) {
    const ticker = p.ticker.toUpperCase();
    if (isExcludedInstrument(ticker)) continue;
    if (p.direction === "neutral") continue;
    entries.push({ ticker, rawScore: p.confidence_pct * p.sources.length });
  }
  return normalizeToMax(entries, LANE_MAX_PREDICTIONS);
}

function laneMovers(ctx: MarketWideContext): Map<string, number> {
  const entries: LaneEntry[] = [];
  for (const m of ctx.market_movers) {
    const ticker = m.ticker.toUpperCase();
    if (isExcludedInstrument(ticker)) continue;
    if (m.price < CANDIDATE_MIN_UNDERLYING_PRICE) continue;
    entries.push({ ticker, rawScore: Math.abs(m.change_pct) });
  }
  return normalizeToMax(entries, LANE_MAX_MOVERS);
}

// ── Whole-market breakout lane (P2b) ────────────────────────────────────────────────
// The banger backtest (docs/audit/0DTE-RESEARCH.md) showed the confluence of gain% × VOLUME ×
// CLOSE-STRENGTH is what separates a real breakout from a weak-closing pop — heavy-volume movers hit
// ≥2× 91% vs 75%. laneMovers only weights abs(change_pct); this lane screens the WHOLE market
// (Polygon grouped-daily, already fetched for breadth — no extra API call) for closed-strong,
// high-volume breakouts and scores them by gain × close-strength. Additive: the corroboration bonus
// handles overlap with the flow/movers lanes, and the existing gates/scorer still decide what
// actually publishes — this only widens the top of the funnel toward tradeable bangers.
export const BREAKOUT_MIN_PRICE = 5;
/**
 * Upper price bound for the whole-market BREAKOUT/BREAKDOWN screen.
 *
 * Was $400 — that silently DROPPED the most liquid 0DTE underlyings once they
 * printed above it (live 2026-07-29: MU ≈ $783, AMD ≈ $432, META ≈ $589 all
 * failed the screen while the momentum-top chain budget was spent on sub-$100
 * names whose nearest listed expiry was a weekly → pickAtmZeroDteContract
 * returned null → `built 0 setup(s)` every scan → board looked FLOW-only even
 * with MERGE v2 + ZERODTE_SRC_BREAKOUT=1 live). Raise to $2,500 so high-priced
 * single-names with real same-day options stay eligible; penny/illiquid noise
 * is still gated by MIN_PRICE + MIN_VOLUME.
 */
export const BREAKOUT_MAX_PRICE = 2_500;
export const BREAKOUT_MIN_VOLUME = 1_000_000;
export const BREAKOUT_MIN_GAIN = 0.03; // lowered from 5% — 3% captures more momentum names while close-strength filter keeps quality
export const BREAKOUT_MIN_CLOSE_STRENGTH = 0.5; // (c−l)/(h−l) — closed in the upper half of the range

/** One whole-market breakout candidate screened from a grouped-daily bar. */
export type BreakoutMover = {
  ticker: string;
  /** Intraday gain (c−o)/o. */
  gain: number;
  volume: number;
  /** (c−l)/(h−l) — 1 = closed on the high (strong), 0 = closed on the low (fade). */
  close_strength: number;
  /** volume × close = $-volume, the liquidity/conviction rank. */
  dollar: number;
  /** Daily bar: h = high, l = low, o = open. Used for gain-over-range ranking. */
  bar: { h: number; l: number; o: number };
};

/** Pure whole-market breakout screen over grouped-daily bars. Returns the top `maxKeep` by $-volume.
 *  Bar shape is Polygon grouped-daily (T/o/h/l/c/v). Deterministic; no IO. */
export function screenBreakoutMovers(
  results: Array<{ T?: string; o?: number; h?: number; l?: number; c?: number; v?: number }>,
  maxKeep = 40
): BreakoutMover[] {
  const out: BreakoutMover[] = [];
  for (const r of results) {
    const ticker = String(r.T ?? "").toUpperCase();
    if (!ticker || ticker.includes(".") || isExcludedInstrument(ticker)) continue;
    const c = Number(r.c);
    const o = Number(r.o);
    const h = Number(r.h);
    const l = Number(r.l);
    const v = Number(r.v);
    if (!(c >= BREAKOUT_MIN_PRICE && c <= BREAKOUT_MAX_PRICE) || !(v >= BREAKOUT_MIN_VOLUME)) continue;
    if (!(o > 0) || (c - o) / o < BREAKOUT_MIN_GAIN) continue;
    const range = h - l;
    const closeStrength = range > 0 ? (c - l) / range : 0;
    if (closeStrength < BREAKOUT_MIN_CLOSE_STRENGTH) continue;
    out.push({ ticker, gain: (c - o) / o, volume: v, close_strength: closeStrength, dollar: v * c, bar: { h, l, o } });
  }
  return out.sort((a, b) => b.dollar - a.dollar).slice(0, maxKeep);
}

/** Pure whole-market BREAKDOWN (short-side) screen over grouped-daily bars. The mirror of
 *  screenBreakoutMovers: screens for gap-DOWN movers (negative gain) that close WEAK (near the
 *  low of the range). Returns the top `maxKeep` by $-volume. `gain` is stored as the ABSOLUTE
 *  value (positive) so the downstream breakoutScore formula works unchanged; `close_strength` is
 *  the RAW (c-l)/(h-l) which is LOW for a breakdown (closed near the low = bearish conviction).
 *  Bar shape is Polygon grouped-daily (T/o/h/l/c/v). Deterministic; no IO. */
export function screenBreakdownMovers(
  results: Array<{ T?: string; o?: number; h?: number; l?: number; c?: number; v?: number }>,
  maxKeep = 40
): BreakoutMover[] {
  const out: BreakoutMover[] = [];
  for (const r of results) {
    const ticker = String(r.T ?? "").toUpperCase();
    if (!ticker || ticker.includes(".") || isExcludedInstrument(ticker)) continue;
    const c = Number(r.c);
    const o = Number(r.o);
    const h = Number(r.h);
    const l = Number(r.l);
    const v = Number(r.v);
    if (!(c >= BREAKOUT_MIN_PRICE && c <= BREAKOUT_MAX_PRICE) || !(v >= BREAKOUT_MIN_VOLUME)) continue;
    // Breakdown = negative gain (gap-down) with magnitude >= the same threshold as breakouts.
    if (!(o > 0)) continue;
    const rawGain = (c - o) / o;
    if (rawGain > -BREAKOUT_MIN_GAIN) continue; // must be a real drop (at least -5%)
    const range = h - l;
    const closeStrength = range > 0 ? (c - l) / range : 1;
    // Weak close = closed near the LOW of the range (close_strength near 0). The inverse of the
    // breakout screen's "closed strong" (near the high). A breakdown that bounced back to close
    // mid-range is not a conviction short.
    if (closeStrength > (1 - BREAKOUT_MIN_CLOSE_STRENGTH)) continue; // close_strength must be <= 0.5
    // Store gain as abs() so breakoutScore's gain factor works unchanged; the caller sets direction.
    out.push({ ticker, gain: Math.abs(rawGain), volume: v, close_strength: closeStrength, dollar: v * c, bar: { h, l, o } });
  }
  return out.sort((a, b) => b.dollar - a.dollar).slice(0, maxKeep);
}

function laneBreakout(ctx: MarketWideContext): Map<string, number> {
  const entries: LaneEntry[] = [];
  for (const m of ctx.breakout_movers ?? []) {
    if (isExcludedInstrument(m.ticker)) continue;
    // A strong-closing 10% mover outranks a weak-closing 10% one; volume is already gated in the screen.
    entries.push({ ticker: m.ticker.toUpperCase(), rawScore: m.gain * (0.5 + m.close_strength) });
  }
  return normalizeToMax(entries, LANE_MAX_BREAKOUT);
}

export type MultiSourceCandidateRow = {
  ticker: string;
  composite_score: number;
  source_count: number;
  sources: string[];
  lane_scores: Record<string, number>;
};

/**
 * Per-lane composition of a SELECTED candidate pool (2026-08-05, root-cause instrumentation): for
 * each lane name, how many of the selected rows it touched (`tickers`) and what share of the
 * pool's total composite score it contributed (`scorePct`, 0-100, rounded). Pure — operates only
 * on the rows/lane names already computed by `extractMultiSourceCandidates`, no I/O — so a lane's
 * real contribution to a given night's pool can be measured and unit-tested directly instead of
 * inferring it from `LANE_MAX_FLOW`'s ceiling (a max-points cap on ONE lane's normalized score,
 * not a measurement of that lane's actual share of the tickers that made the final cut).
 */
export function laneComposition(
  rows: MultiSourceCandidateRow[],
  laneNames: string[]
): Record<string, { tickers: number; scorePct: number }> {
  const tickerCounts: Record<string, number> = {};
  const scoreSums: Record<string, number> = {};
  for (const name of laneNames) {
    tickerCounts[name] = 0;
    scoreSums[name] = 0;
  }
  let totalScore = 0;
  for (const row of rows) {
    totalScore += row.composite_score;
    for (const [name, pts] of Object.entries(row.lane_scores)) {
      tickerCounts[name] = (tickerCounts[name] ?? 0) + 1;
      scoreSums[name] = (scoreSums[name] ?? 0) + pts;
    }
  }
  const out: Record<string, { tickers: number; scorePct: number }> = {};
  for (const name of laneNames) {
    out[name] = {
      tickers: tickerCounts[name] ?? 0,
      scorePct: totalScore > 0 ? Math.round(((scoreSums[name] ?? 0) / totalScore) * 100) : 0,
    };
  }
  return out;
}

/** Compact one-line rendering of {@link laneComposition} for console/log output. */
export function formatLaneComposition(comp: Record<string, { tickers: number; scorePct: number }>): string {
  return Object.entries(comp)
    .map(([name, c]) => `${name}=${c.tickers}t/${c.scorePct}%`)
    .join(" ");
}

/** How many of the top-ranked names are admitted regardless of source_count (2026-08-05) — a
 *  genuinely dominant single-lane signal (e.g. a massive, unmistakable options sweep) is real
 *  evidence on its own and must not be discarded just because only one lane happened to see it
 *  first; corroboration hasn't caught up yet doesn't mean the signal is wrong. Below this rank,
 *  admission requires corroboration (see {@link applyConfluenceGate}). */
export const CONFLUENCE_PROTECTED_TOP = 20;
/** Minimum distinct lanes for a candidate ranked below {@link CONFLUENCE_PROTECTED_TOP} to enter
 *  the pool — single-lane "OI change only" or "mover only" noise below the protected top no
 *  longer gets a dossier just for showing up in exactly one lane. */
export const CONFLUENCE_MIN_SOURCES = 2;

/**
 * Confluence admission gate (2026-08-05, discovery-architecture redesign — operator's read: "the
 * selection has to be strong, not just OI/Flow"). `rows` must already be sorted by
 * `composite_score` descending. The top `protectedTop` are admitted unconditionally (protects a
 * genuinely dominant single-lane signal); every row after that must have `source_count >=
 * minSources` to be admitted. Pure and order-preserving — never re-sorts, only filters — so a
 * pre-sorted `rows` array in is a pre-sorted (possibly shorter) array out. Stops once `maxTickers`
 * have been admitted so a long tail of single-lane names doesn't need to be fully scanned.
 */
export function applyConfluenceGate(
  rows: MultiSourceCandidateRow[],
  maxTickers: number,
  protectedTop: number = CONFLUENCE_PROTECTED_TOP,
  minSources: number = CONFLUENCE_MIN_SOURCES
): MultiSourceCandidateRow[] {
  const admitted: MultiSourceCandidateRow[] = [];
  for (let i = 0; i < rows.length && admitted.length < maxTickers; i++) {
    const row = rows[i]!;
    if (i < protectedTop || row.source_count >= minSources) admitted.push(row);
  }
  return admitted;
}

/**
 * Multi-source candidate discovery — replaces the flow-only extractCandidateTickers
 * for the edition pipeline. Runs 6 independent scoring lanes over MarketWideContext,
 * applies corroboration bonuses for tickers seen in multiple lanes, enriches with DB
 * streak/unusualness data when available, and returns top-N tickers by composite score.
 */
export async function extractMultiSourceCandidates(
  ctx: MarketWideContext,
  maxTickers: number
): Promise<string[]> {
  const lanes: [string, Map<string, number>][] = [
    ["flow", laneFlow(ctx)],
    ["oi_change", laneOiChange(ctx)],
    ["unusual_trades", laneUnusualTrades(ctx)],
    ["catalyst", laneCatalyst(ctx)],
    ["predictions", lanePredictions(ctx.predictions_consensus)],
    ["movers", laneMovers(ctx)],
    ["breakout", laneBreakout(ctx)],
  ];

  const composite = new Map<string, { score: number; sources: string[]; laneScores: Record<string, number> }>();
  for (const [name, scores] of lanes) {
    for (const [ticker, pts] of scores) {
      const cur = composite.get(ticker) ?? { score: 0, sources: [], laneScores: {} };
      cur.score += pts;
      cur.sources.push(name);
      cur.laneScores[name] = pts;
      composite.set(ticker, cur);
    }
  }

  // Corroboration ("stacked hits") bonus: a ticker multiple independent lanes agree on is a more
  // reliable signal than any single lane's raw score, so it's boosted before ranking. Added a 4th
  // tier (2026-08-05): a name every lane types considers notable (4+ distinct sources, or every
  // lane in play) is a materially different, rarer signal than "merely 2 lanes agree" and now gets
  // its own boost tier rather than capping at the same 1.3x a bare 3-source name gets.
  for (const [, entry] of composite) {
    if (entry.sources.length >= 4) entry.score *= 1.45;
    else if (entry.sources.length >= 3) entry.score *= 1.3;
    else if (entry.sources.length >= 2) entry.score *= 1.15;
  }

  const tickers = Array.from(composite.keys());
  if (!tickers.length) return [];

  // DB enrichment: streak multiplier + unusualness ratio (same as legacy path).
  let avgPremiums: Record<string, number> = {};
  let streaks: Record<string, { streak_days: number }> = {};
  if (dbConfigured()) {
    [avgPremiums, streaks] = await Promise.all([
      fetchTickersAvgDailyPremium(tickers, CANDIDATE_UNUSUALNESS_LOOKBACK_DAYS),
      fetchTickersFlowStreaks(tickers),
    ]);
  }

  const rows: MultiSourceCandidateRow[] = [];
  for (const [ticker, entry] of composite) {
    let score = entry.score;

    // Streak bonus (flow lane already captured the premium; this adds temporal conviction).
    const streakDays = streaks[ticker]?.streak_days ?? 0;
    score *= streakMultiplier(streakDays);

    // Unusualness ratio from flow lane raw premium vs 30-day avg.
    const flowLane = lanes.find(([n]) => n === "flow");
    if (flowLane) {
      const flowRaw = flowLane[1].get(ticker);
      if (flowRaw && flowRaw > 0) {
        const baseline = Math.max(avgPremiums[ticker] ?? 0, CANDIDATE_MIN_BASELINE_PREMIUM);
        score *= unusualnessMultiplier(flowRaw / baseline);
      }
    }

    rows.push({
      ticker,
      composite_score: score,
      source_count: entry.sources.length,
      sources: entry.sources,
      lane_scores: entry.laneScores,
    });
  }

  rows.sort((a, b) => b.composite_score - a.composite_score);

  const selectedRows = applyConfluenceGate(rows, maxTickers);
  const selected = selectedRows.map((r) => r.ticker);
  const multiSourceCount = rows.filter((r) => r.source_count >= 2).length;
  const singleLaneSelected = selectedRows.filter((r) => r.source_count < CONFLUENCE_MIN_SOURCES).length;
  console.info(
    `[nighthawk/candidates] multi-source: ${composite.size} unique tickers from ${lanes.length} lanes, ` +
    `${multiSourceCount} corroborated, selected top ${selected.length} ` +
    `(${singleLaneSelected} single-lane, all within the protected top ${CONFLUENCE_PROTECTED_TOP})`
  );

  // Per-lane composition of the SELECTED pool (2026-08-05, instrumentation only — no behavior
  // change). Answers "is the pool really ~40% flow?" from real nightly data instead of reading
  // LANE_MAX_FLOW's ceiling as a proxy for actual pool composition — a ceiling on a lane's max
  // normalized score is not the same as that lane's share of the tickers that actually made the
  // cut. Logged, never persisted — read from ECS/CloudWatch logs when diagnosing a thin-output
  // night.
  const laneNames = lanes.map(([name]) => name);
  console.info(
    `[nighthawk/candidates] lane composition of selected pool: ` +
    formatLaneComposition(laneComposition(selectedRows, laneNames))
  );

  return selected;
}
