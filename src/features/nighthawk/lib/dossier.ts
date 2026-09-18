import {
  fetchBenzingaCatalysts,
  fetchBenzingaEarnings,
  fetchBenzingaNews,
  fetchBenzingaPriceTarget,
  fetchPolygonBalanceSheets,
  fetchPolygonCashFlowStatements,
  fetchPolygonFinancialRatios,
  fetchPolygonIncomeStatements,
  fetchShortInterest,
  fetchVixIvRankPercentile,
  computeFundamentalSignals,
  type BenzingaCatalyst,
  type BenzingaPriceTarget,
  type FundamentalSignals,
  type PolygonFinancialRatios,
} from "@/lib/providers/polygon";
import { serverCache, TTL } from "@/lib/server-cache";
import { fetchPolygonRealizedVol } from "@/lib/providers/polygon-options-gex";
import { fetchPolygonNews, fetchPolygonTickerDetails } from "@/lib/providers/polygon-largo";
import { uwConfigured } from "@/lib/providers/config";
import {
  fetchMarketFlowAlertRows,
  fetchUwCongressUnusualTrades,
  fetchUwDarkPool,
  fetchUwFdaCalendar,
  fetchUwFlowPerExpiry,
  fetchUwInsiderTransactions,
  fetchUwInstitutionOwnership,
  fetchUwIvRank,
  fetchUwIvTermStructure,
  fetchUwOiChange,
  fetchUwPredictionsConsensus,
  fetchUwRealizedVol,
  fetchUwGreekFlow,
  fetchUwRiskReversalSkew,
  fetchUwScreenerStocks,
  type PredictionConsensusSignal,
} from "@/lib/providers/unusual-whales";
import { computeFlowStrikeStacks, type FlowStrikeStack } from "@/lib/largo/flow-strike-stacks";
import { fetchTickerFlowStreak, type FlowStreak } from "./flow-streak";
import { fetchPositioningSummary, type PositioningSummary } from "./positioning";
import { buildTechnicalCard, type TechnicalCard } from "./technicals";
import type { ScoredCandidate, NightHawkRegimeContext } from "./scorer";
import { scoreCandidate } from "./scorer";
import { shouldBlockForTradingHalt } from "@/lib/ws/uw-socket";
import { runUwPooled } from "@/lib/providers/uw-rate-limiter";
import { DOSSIER_BATCH_SIZE, DOSSIER_FETCH_TIMEOUT_MS, DOSSIER_INTER_BATCH_MS, DOSSIER_TICKER_WALL_MS } from "./constants";
import { dossierFetch } from "./fetch-timeout";
import { parseLatestRealizedVol, parseLatestRiskReversalSkew } from "./vol-metrics";
import { summarizeTickerGreekFlow, type TickerGreekFlowSummary } from "./ticker-greek-flow-summary";
export type { TickerGreekFlowSummary } from "./ticker-greek-flow-summary";
export { summarizeTickerGreekFlow } from "./ticker-greek-flow-summary";

export type TickerDossier = {
  ticker: string;
  flows: Record<string, unknown>[];
  flow_streak: FlowStreak;
  strike_stacks: FlowStrikeStack[];
  dark_pool: Awaited<ReturnType<typeof fetchUwDarkPool>> | null;
  oi_change: Awaited<ReturnType<typeof fetchUwOiChange>>;
  iv_rank: number | null;
  iv_term: Array<{ expiry: string; iv: number }>;
  realized_vol: number | null;
  risk_reversal_skew: number | null;
  flow_by_expiry: Record<string, unknown>[];
  // Null when no positioning data exists — fetchPositioningSummary returns null on a
  // cold cache + empty bundle rather than a fabricated flat book. Scorers null-guard it.
  positioning: PositioningSummary | null;
  congress_trades: Record<string, unknown>[];
  congress_unusual: Record<string, unknown>[];
  institutional_activity: Record<string, unknown>[];
  predictions_signal: PredictionConsensusSignal | null;
  screener_confirmed: boolean;
  tech: TechnicalCard | null;
  news_headlines: string[];
  /** Recent corporate catalysts (FDA/guidance/M&A/insider/buyback/offering) from free Benzinga channels. */
  catalysts: BenzingaCatalyst[];
  polygon_sentiment: string[];
  analyst_summary: string | null;
  price_target: string | null;
  insider_buys: number;
  sector: string | null;
  short_days_to_cover: number | null;
  fundamental_ratios: PolygonFinancialRatios | null;
  /** Derived revenue/margin/FCF/debt/EPS/share-count trends from the three statements. */
  fundamental_signals: FundamentalSignals | null;
  /** Parsed Benzinga analyst price target (price target news channel). */
  benzinga_price_target: BenzingaPriceTarget | null;
  trading_halt: boolean;
  /**
   * UW FDA calendar events for this ticker — only fetched when a binary/FDA Benzinga
   * catalyst is detected. Provides structured drug name, date, indication for the prompt.
   * Empty array when no FDA catalyst is flagged or UW is unconfigured.
   */
  fda_events: Record<string, unknown>[];
  greek_flow: TickerGreekFlowSummary | null;
  scored?: ScoredCandidate;
};

/**
 * Per-ticker financials bundle: widened ratios + derived statement signals + parsed analyst PT.
 * Financials change SLOWLY, so this is cached on a long (1h REFERENCE) TTL — the cache-reader rule:
 * 500 concurrent edition builds / users share ONE upstream pull per ticker per window, with NO
 * uncapped fan-out (the three statement calls + ratios + PT run as a bounded Promise.all).
 */
type FinancialsBundle = {
  ratios: PolygonFinancialRatios | null;
  signals: FundamentalSignals | null;
  priceTarget: BenzingaPriceTarget | null;
};

async function fetchFinancialsBundle(sym: string): Promise<FinancialsBundle> {
  return serverCache(`nighthawk:financials:${sym}`, TTL.REFERENCE, async () => {
    const [ratios, income, balance, cashFlow, priceTarget] = await Promise.all([
      fetchPolygonFinancialRatios(sym).catch(() => null),
      fetchPolygonIncomeStatements(sym, 6).catch(() => []),
      fetchPolygonBalanceSheets(sym, 6).catch(() => []),
      fetchPolygonCashFlowStatements(sym, 6).catch(() => []),
      fetchBenzingaPriceTarget(sym).catch(() => null),
    ]);
    return {
      ratios,
      signals: computeFundamentalSignals(income, balance, cashFlow),
      priceTarget,
    };
  });
}

/** One-line analyst summary built from the parsed Benzinga PT. */
function analystSummaryFromPt(pt: BenzingaPriceTarget | null): string | null {
  if (!pt) return null;
  const firm = pt.firm ? `${pt.firm} ` : "";
  const act = pt.action ? `${pt.action} ` : "";
  return `${firm}${act}PT to $${pt.price_target.toLocaleString()}`.trim();
}

/** "Analyst PT $X (Firm)" line for the dossier price_target field. */
function priceTargetLineFromPt(pt: BenzingaPriceTarget | null): string | null {
  if (!pt) return null;
  const firm = pt.firm ? ` (${pt.firm})` : "";
  return `Analyst PT $${pt.price_target.toLocaleString()}${firm}`;
}

/**
 * Per-build cache for edition-wide API calls (congress trades, predictions,
 * screener). Each concurrent build should construct its own DossierBuildCache
 * and pass it through so builds cannot cross-contaminate each other's data.
 *
 * The module-level `_defaultBuildCache` is kept for backward-compatibility with
 * callers that invoke `fetchTickerDossier` directly without a build cache; those
 * callers should migrate to passing an explicit cache or use `fetchAllDossiers`.
 */
export type DossierBuildCache = {
  congress: Record<string, unknown>[] | null;
  predictions: Awaited<ReturnType<typeof fetchUwPredictionsConsensus>> | null;
  screener: Record<string, unknown>[] | null;
};

export function createDossierBuildCache(): DossierBuildCache {
  return { congress: null, predictions: null, screener: null };
}

// Module-level default cache — used only by legacy single-build call sites.
// Concurrent builds must pass an explicit DossierBuildCache to avoid
// cross-contamination between concurrent edition builds.
let _defaultBuildCache: DossierBuildCache = createDossierBuildCache();

const RECENT_SIGNAL_DAYS = 30;

// `filed_at_date` (real UW congress field) and `filing_date` (real UW insider/institutional
// field) are checked FIRST, ahead of `transaction_date` — a congress member or corporate
// insider can legally disclose a trade up to 45/2+ days after the trade itself (STOCK Act /
// Form 4 windows), so the DISCLOSURE date, not the trade date, is when this recency window
// should measure from. Same root cause already fixed once this session in
// `congressTradeDecayMultiplier` (scorer.ts, #4844) — this is the blast-radius instance that
// governs whether a row is even considered "recent" at all (getEditionCongressTrades's window,
// isRecentInsiderBuy's window), not just how it's decayed/weighted.
export function parseTradeDate(row: Record<string, unknown>): Date | null {
  const raw =
    row.filed_at_date ??
    row.filing_date ??
    row.filed_at ??
    row.filed_date ??
    row.transaction_date ??
    row.transactionDate ??
    row.disclosure_date ??
    row.report_date ??
    row.date ??
    row.created_at;
  if (raw == null || raw === "") return null;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isWithinRecentSignalWindow(row: Record<string, unknown>, days = RECENT_SIGNAL_DAYS): boolean {
  const tradeDate = parseTradeDate(row);
  if (!tradeDate) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return tradeDate >= cutoff;
}

function isRecentInsiderBuy(row: Record<string, unknown>): boolean {
  if (!isWithinRecentSignalWindow(row)) return false;
  const tx = String(row.transactionCode ?? row.transaction_code ?? "").toUpperCase();
  const type = String(row.type ?? row.transaction_type ?? row.action ?? "").toUpperCase();
  const buySell = String(row.buy_sell ?? row.buySell ?? "").toUpperCase();
  return tx === "P" || type.includes("BUY") || type.includes("PURCHASE") || buySell.includes("BUY");
}

function sectorFromPolygonDetails(profile: Record<string, unknown> | null): string | null {
  if (!profile) return null;
  const results = (profile.results as Record<string, unknown> | undefined) ?? profile;
  const sector = results.sic_description ?? results.sector ?? results.industry;
  return sector != null ? String(sector) : null;
}

/** Resets the module-level default build cache used by legacy single-build callers. */
export function resetEditionCongressCache() {
  _defaultBuildCache = createDossierBuildCache();
}

async function getEditionCongressTrades(
  ticker: string,
  cache: DossierBuildCache,
  signal?: AbortSignal
): Promise<Record<string, unknown>[]> {
  if (!uwConfigured()) return [];
  if (!cache.congress) {
    const { fetchUwCongressTrades } = await import("@/lib/providers/unusual-whales");
    cache.congress = (await fetchUwCongressTrades(undefined, 25, signal).catch(() => [])) as Record<string, unknown>[];
  }
  const sym = ticker.toUpperCase();
  return cache.congress
    .filter((t) => String(t.ticker ?? t.symbol ?? "").toUpperCase() === sym)
    .filter((t) => isWithinRecentSignalWindow(t))
    .slice(0, 5);
}

async function getEditionPredictionsSignal(
  ticker: string,
  cache: DossierBuildCache,
  // Accepted for signature consistency with the other two cache-amortized helpers above,
  // but NOT yet forwarded into fetchUwPredictionsConsensus — that function fans out to 4
  // further UW calls internally (insiders/smart-money/unusual/whales) and wiring real
  // cancellation through all 4 is a separate, disclosed follow-up, not part of this patch.
  _signal?: AbortSignal
): Promise<PredictionConsensusSignal | null> {
  if (!uwConfigured()) return null;
  if (!cache.predictions) {
    cache.predictions = await fetchUwPredictionsConsensus(40).catch(() => null);
  }
  const sym = ticker.toUpperCase();
  return cache.predictions?.top_signals?.find((s) => s.ticker === sym) ?? null;
}

async function isScreenerConfirmed(ticker: string, cache: DossierBuildCache, signal?: AbortSignal): Promise<boolean> {
  if (!uwConfigured()) return false;
  if (!cache.screener) {
    cache.screener = (await fetchUwScreenerStocks(30, signal).catch(() => [])) as Record<string, unknown>[];
  }
  const sym = ticker.toUpperCase();
  return cache.screener.some((r) => String(r.ticker ?? r.symbol ?? "").toUpperCase() === sym);
}

const INDEX_IV_PROXY = new Set(["SPX", "SPY", "QQQ", "VIX", "IWM"]);

/** Polygon VIX IV rank for index proxies; UW only as fallback for single names. */
async function resolveIvRank(sym: string, signal?: AbortSignal): Promise<number | null> {
  if (INDEX_IV_PROXY.has(sym)) {
    const rank = await fetchVixIvRankPercentile().catch(() => null);
    if (rank != null) return rank;
  }
  if (!uwConfigured()) return null;
  const raw = await fetchUwIvRank(sym, signal).catch(() => null);
  return raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
}

async function resolveTickerNews(
  // sym unused now that UW fallback is removed — kept for signature stability
  _sym: string,
  polyNews: Awaited<ReturnType<typeof fetchPolygonNews>>,
  bzNews: Awaited<ReturnType<typeof fetchBenzingaNews>>
): Promise<string[]> {
  // Benzinga (paid) + Polygon are sufficient; UW news quota reserved for flow/tide/dark pool.
  return [
    ...bzNews.map((n) => String(n.title ?? "")),
    ...polyNews.map((n) => String(n.title ?? "")),
  ].filter(Boolean);
}

/**
 * Session-date context for earnings-proximity scoring — the same shape hunt-builder.ts's
 * rescoreDossier already takes. Optional and additive: when omitted, scoreCandidate's
 * earnings_date/today_ymd/tomorrow_ymd stay unset here exactly as they always have (this
 * function's own pre-existing behavior), same as before this type/param existed.
 */
export type DossierSessionContext = {
  today: string;
  tomorrow: string;
  tomorrow_earnings: Record<string, unknown>[];
};

/** Returns tomorrow's date (YYYY-MM-DD) if the ticker appears in tomorrow_earnings, else null.
 *  Deliberately duplicated from hunt-builder.ts's own private helper of the same name/logic
 *  (not imported) — hunt-builder.ts imports fetchAllDossiers FROM this file, so importing back
 *  from hunt-builder.ts here would create a circular import. */
export function earningsDateForTicker(
  ticker: string,
  tomorrowEarnings: Record<string, unknown>[],
  tomorrow: string
): string | null {
  const sym = ticker.toUpperCase();
  const hit = tomorrowEarnings.some(
    (r) => String(r.ticker ?? r.symbol ?? "").toUpperCase() === sym
  );
  return hit ? tomorrow : null;
}

export async function fetchTickerDossier(
  ticker: string,
  regime?: NightHawkRegimeContext | null,
  buildCache?: DossierBuildCache,
  signal?: AbortSignal,
  sessionCtx?: DossierSessionContext
): Promise<TickerDossier> {
  // Fall back to the module-level default cache for legacy callers that do not
  // supply an explicit build cache. Concurrent edition builds must pass their
  // own DossierBuildCache (via fetchAllDossiers) to avoid cross-contamination.
  const cache = buildCache ?? _defaultBuildCache;
  const sym = ticker.toUpperCase();
  const t = DOSSIER_FETCH_TIMEOUT_MS;
  const uw = uwConfigured();

  const [
    flowRows,
    ivRankRaw,
    positioning,
    tech,
    polyNews,
    bzNews,
    profile,
    shortSi,
    flowStreak,
    congress,
    predictionsSignal,
    screenerConfirmed,
    financials,
    catalysts,
  ] = await Promise.all([
    // UW-touching (real cancellation wired below): fn receives dossierFetch's combined
    // signal (this call's own 8s local timeout, OR'd with the ticker-level wall passed
    // as `signal` here) and threads it into the real fetchMarketFlowAlertRows call.
    dossierFetch((s) => fetchMarketFlowAlertRows({ ticker: sym, limit: 80, min_premium: 50_000 }, s), [], t, signal),
    dossierFetch((s) => resolveIvRank(sym, s), null, t, signal),
    // Polygon-only (not UW, not the contended shared budget) — outer signal still
    // aborts THIS dossierFetch's own controller immediately on wall-timeout, but
    // fetchPositioningSummary itself does not yet accept a signal to cancel its own
    // underlying request. Fallback is null (not a fabricated flat book): on
    // timeout/error we have no positioning data, so say so honestly rather than
    // inventing net_gex:0 / negative_gamma:false. Downstream scorers null-guard it.
    dossierFetch(() => fetchPositioningSummary(sym), null, t, signal),
    dossierFetch(() => buildTechnicalCard(sym), null, t, signal),
    dossierFetch(() => fetchPolygonNews(sym, 8), [], t, signal),
    // Merge Benzinga general news + earnings articles so the dossier scoring pass
    // sees earnings-channel items (guidance beats/misses, reaction pieces) that the
    // plain fetchBenzingaNews call omits. Bounded: 5 general + 5 earnings = 10 max.
    dossierFetch(async () => {
      const [general, earnings] = await Promise.all([
        fetchBenzingaNews(5, { ticker: sym }),
        fetchBenzingaEarnings(sym, 5),
      ]);
      // Deduplicate by title (earnings articles sometimes appear in general too).
      const seen = new Set<string>();
      const merged: typeof general = [];
      for (const item of [...general, ...earnings]) {
        const key = (item as { title?: string }).title ?? "";
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(item);
        }
      }
      return merged;
    }, [], t, signal),
    dossierFetch(() => fetchPolygonTickerDetails(sym), null, t, signal),
    dossierFetch(() => fetchShortInterest(sym), null, t, signal),
    dossierFetch(
      () => fetchTickerFlowStreak(sym),
      { streak_days: 0, net_3d: 0, net_5d: 0, direction: "mixed" as const },
      t,
      signal
    ),
    // UW-touching, but cache-amortized ONCE per whole build (DossierBuildCache), not
    // per ticker — still threaded for correctness on the one ticker that triggers it.
    dossierFetch((s) => getEditionCongressTrades(sym, cache, s), [], t, signal),
    dossierFetch((s) => getEditionPredictionsSignal(sym, cache, s), null, t, signal),
    dossierFetch((s) => isScreenerConfirmed(sym, cache, s), false, t, signal),
    dossierFetch(
      () => fetchFinancialsBundle(sym),
      { ratios: null, signals: null, priceTarget: null },
      t,
      signal
    ),
    // Free Benzinga catalysts — folded into the existing bounded Promise.all (NO new uncapped
    // fan-out). fetchBenzingaCatalysts is itself per-ticker cache-read, so concurrent builds share
    // one upstream pull per ticker per window (cache-reader rule).
    dossierFetch(() => fetchBenzingaCatalysts(sym), [] as BenzingaCatalyst[], t, signal),
  ]);
  const fundamentalRatios = financials.ratios;
  const fundamentalSignals = financials.signals;
  const benzingaPriceTarget = financials.priceTarget;

  // UW FDA calendar — only fetch when Benzinga flags a binary/FDA catalyst for this ticker.
  // fetchUwFdaCalendar uses a shared Redis cache key so concurrent builds share one pull.
  const hasFdaCatalyst = catalysts.some((c) => {
    const type = String((c as Record<string, unknown>).type ?? "").toLowerCase();
    const title = String((c as Record<string, unknown>).title ?? (c as Record<string, unknown>).headline ?? "").toLowerCase();
    return type === "binary" || title.includes("fda") || title.includes("pdufa") || title.includes("nda");
  });
  const fdaEvents: Record<string, unknown>[] = hasFdaCatalyst && uw
    ? await dossierFetch((s) => fetchUwFdaCalendar(sym, 5, s), [], t, signal).then(
        (rows) => (rows as Record<string, unknown>[]).filter(
          (r) => String(r.ticker ?? r.symbol ?? "").toUpperCase() === sym
        )
      )
    : [];

  const [
    darkPool,
    oiChange,
    ivTermRaw,
    realizedVolRaw,
    skewRaw,
    flowExpiry,
    insider,
    congressUnusual,
    institutional,
    greekFlowRaw,
  ] = uw
    ? await runUwPooled([
        () => dossierFetch((s) => fetchUwDarkPool(sym, undefined, s), null, t, signal),
        () => dossierFetch((s) => fetchUwOiChange(sym, s), [], t, signal),
        () => dossierFetch((s) => fetchUwIvTermStructure(sym, s), [], t, signal),
        () => dossierFetch(async (s) => {
          const poly = await fetchPolygonRealizedVol(sym);
          if (poly && poly.realized_vol_30d > 0) return [poly];
          return fetchUwRealizedVol(sym, 15, s);
        }, [], t, signal),
        () => dossierFetch((s) => fetchUwRiskReversalSkew(sym, 15, s), [], t, signal),
        () => dossierFetch((s) => fetchUwFlowPerExpiry(sym, 12, s), [], t, signal),
        () => dossierFetch((s) => fetchUwInsiderTransactions(sym, 20, s), [], t, signal),
        () => dossierFetch((s) => fetchUwCongressUnusualTrades(sym, 5, s), [], t, signal),
        () => dossierFetch((s) => fetchUwInstitutionOwnership(sym, 8, s), [], t, signal),
        () => dossierFetch((s) => fetchUwGreekFlow(sym, undefined, 500, s), [], t, signal),
      ], 2)
    : [null, [], [], [], [], [], [], [], [], []];

  const flows = flowRows.map((r) => r.raw);
  const strikeStacks = computeFlowStrikeStacks(flows, { minAlerts: 2, limit: 8 });

  const polygonSentiment: string[] = [];
  for (const article of polyNews) {
    const insights = (article as { insights?: Array<Record<string, unknown>> }).insights;
    if (!Array.isArray(insights)) continue;
    for (const ins of insights) {
      if (String(ins.ticker ?? "").toUpperCase() !== sym) continue;
      const sent = String(ins.sentiment ?? "").toLowerCase();
      const reason = String(ins.sentiment_reasoning ?? ins.reasoning ?? "").slice(0, 120);
      if (sent && reason) polygonSentiment.push(`${sent}: ${reason}`);
    }
  }

  const headlines = await resolveTickerNews(sym, polyNews, bzNews);

  const insiderRows = insider as Record<string, unknown>[];
  const insiderBuys = insiderRows.filter((row) => isRecentInsiderBuy(row)).length;

  const ivRank = ivRankRaw != null && Number.isFinite(ivRankRaw) ? Number(ivRankRaw) : null;
  const ivTerm = ivTermRaw ?? [];
  const realizedVol = parseLatestRealizedVol((realizedVolRaw ?? []) as Record<string, unknown>[]);
  const riskReversalSkew = parseLatestRiskReversalSkew((skewRaw ?? []) as Record<string, unknown>[]);
  // Only exclude on a GENUINE active halt — NOT the live-desk "fail closed when the halt
  // feed is stale" safeguard. The edition builds after-hours/overnight for the NEXT session,
  // when the UW trading_halts channel is naturally quiet (= "stale"); fail-closing there
  // wrongly marks every ticker halted and zeroes the entire edition.
  const tradingHalt = shouldBlockForTradingHalt([sym], { failClosedOnStale: false }).block;
  const greekFlow = summarizeTickerGreekFlow((greekFlowRaw ?? []) as Record<string, unknown>[]);

  const dossier: TickerDossier = {
    ticker: sym,
    flows,
    flow_streak: flowStreak,
    strike_stacks: strikeStacks,
    dark_pool: darkPool,
    oi_change: oiChange,
    iv_rank: ivRank,
    iv_term: ivTerm,
    realized_vol: realizedVol,
    risk_reversal_skew: riskReversalSkew,
    flow_by_expiry: flowExpiry,
    positioning,
    congress_trades: congress,
    congress_unusual: congressUnusual,
    institutional_activity: institutional,
    predictions_signal: predictionsSignal,
    screener_confirmed: screenerConfirmed,
    tech,
    news_headlines: headlines,
    catalysts,
    polygon_sentiment: polygonSentiment,
    analyst_summary: analystSummaryFromPt(benzingaPriceTarget),
    price_target: priceTargetLineFromPt(benzingaPriceTarget),
    insider_buys: insiderBuys,
    sector: sectorFromPolygonDetails(profile),
    short_days_to_cover: shortSi?.days_to_cover ?? null,
    fundamental_ratios: fundamentalRatios,
    fundamental_signals: fundamentalSignals,
    benzinga_price_target: benzingaPriceTarget,
    trading_halt: tradingHalt,
    fda_events: fdaEvents,
    greek_flow: greekFlow,
  };

  // Earnings-proximity scoring (audit gap fix, Night Hawk Legacy Signal Intelligence Phase 1):
  // this was the FIRST scoring pass's own missing earnings_date/today_ymd/tomorrow_ymd -- the
  // edition pipeline already patches it via a downstream rescoreDossier() re-score
  // (edition-builder.ts), which still runs unconditionally and produces an IDENTICAL final
  // dossier.scored, so this fix does not change the edition path's published output. It DOES fix
  // the two real callers that read dossier.scored straight from this function with no subsequent
  // rescore: zerodte/scan.ts's own dossier borrow, and (when sessionCtx is threaded through by a
  // future caller) play-explainer.ts's fallback narrative path.
  const earningsDate = sessionCtx
    ? earningsDateForTicker(sym, sessionCtx.tomorrow_earnings, sessionCtx.tomorrow)
    : null;

  dossier.scored = scoreCandidate(
    sym,
    flows,
    tech,
    {
      dark_pool: darkPool,
      oi_change: oiChange,
      positioning,
      strike_stacks: strikeStacks,
      news_headlines: [...headlines, ...polygonSentiment],
      catalysts,
      insider_buys: insiderBuys,
      predictions_signal: predictionsSignal,
      congress_unusual: congressUnusual,
      congress_trades: congress,
      institutional_activity: institutional,
      fundamental_ratios: fundamentalRatios,
      fundamental_signals: fundamentalSignals,
      trading_halt: tradingHalt,
      risk_reversal_skew: riskReversalSkew,
      short_days_to_cover: shortSi?.days_to_cover ?? null,
      benzinga_price_target: benzingaPriceTarget,
      greek_flow: greekFlow,
      iv_rank: ivRank,
      fda_events: fdaEvents,
      earnings_date: earningsDate,
      today_ymd: sessionCtx?.today ?? null,
      tomorrow_ymd: sessionCtx?.tomorrow ?? null,
    },
    flowStreak,
    regime
  );

  return dossier;
}

async function fetchTickerDossierWithWall(
  ticker: string,
  regime?: NightHawkRegimeContext | null,
  buildCache?: DossierBuildCache,
  sessionCtx?: DossierSessionContext
): Promise<TickerDossier | null> {
  // PHASE 2 CANCELLATION (2026-09-17): same 45s wall, same timing, same resolve-to-null
  // behavior on timeout as before — the ONLY change is that the wall timer now ALSO
  // aborts every outstanding fetch for this ticker at the moment it fires, instead of
  // merely giving up on waiting for them. `wallController.signal` threads down through
  // fetchTickerDossier -> dossierFetch -> the UW provider functions -> trackedFetch's
  // real fetch() call, so a timed-out ticker's requests are actually terminated rather
  // than continuing to run in the background and hold a shared UW rate-limiter slot.
  const wallController = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetchTickerDossier(ticker, regime, buildCache, wallController.signal, sessionCtx),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          console.warn(
            `[nighthawk/dossier] ${ticker.toUpperCase()} wall timeout (${DOSSIER_TICKER_WALL_MS}ms) — skipping`
          );
          wallController.abort(new DOMException(`ticker wall timeout (${DOSSIER_TICKER_WALL_MS}ms)`, "AbortError"));
          resolve(null);
        }, DOSSIER_TICKER_WALL_MS);
      }),
    ]);
  } catch (err) {
    console.error(`[nighthawk/dossier] ${ticker} failed:`, err);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchAllDossiers(
  tickers: string[],
  batchSize = DOSSIER_BATCH_SIZE,
  regime?: NightHawkRegimeContext | null,
  onComplete?: (d: TickerDossier) => Promise<void>,
  sessionCtx?: DossierSessionContext
): Promise<Record<string, TickerDossier>> {
  // Create a single build cache scoped to this fetchAllDossiers invocation so
  // concurrent calls (e.g. two edition builds running simultaneously) each get
  // their own isolated congress/predictions/screener snapshot and cannot
  // overwrite each other's module-level state.
  const buildCache = createDossierBuildCache();
  const out: Record<string, TickerDossier> = {};
  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((ticker) => fetchTickerDossierWithWall(ticker, regime, buildCache, sessionCtx))
    );

    for (const d of results) {
      if (!d) continue;
      out[d.ticker] = d;
      if (onComplete) await onComplete(d);
    }

    if (i + batchSize < tickers.length) {
      await new Promise((r) => setTimeout(r, DOSSIER_INTER_BATCH_MS));
    }
  }
  return out;
}
