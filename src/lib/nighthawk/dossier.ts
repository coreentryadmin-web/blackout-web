import { fetchBenzingaNews, fetchShortInterest, fetchVixIvRankPercentile } from "@/lib/providers/polygon";
import { fetchPolygonNews } from "@/lib/providers/polygon-largo";
import { uwConfigured } from "@/lib/providers/config";
import {
  fetchFinnhubCompanyNews,
  fetchFinnhubCompanyProfile,
  fetchFinnhubInsiderTransactions,
  fetchFinnhubPriceTarget,
  fetchFinnhubRecommendations,
} from "@/lib/providers/finnhub";
import {
  fetchMarketFlowAlertRows,
  fetchUwDarkPool,
  fetchUwFlowPerExpiry,
  fetchUwIvRank,
  fetchUwNewsHeadlines,
  fetchUwOiChange,
} from "@/lib/providers/unusual-whales";
import { computeFlowStrikeStacks, type FlowStrikeStack } from "@/lib/largo/flow-strike-stacks";
import { fetchTickerFlowStreak, type FlowStreak } from "./flow-streak";
import { fetchPositioningSummary, type PositioningSummary } from "./positioning";
import { buildTechnicalCard, type TechnicalCard } from "./technicals";
import type { ScoredCandidate } from "./scorer";
import { scoreCandidate } from "./scorer";

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
  positioning: PositioningSummary;
  congress_trades: Record<string, unknown>[];
  tech: TechnicalCard | null;
  news_headlines: string[];
  polygon_sentiment: string[];
  analyst_summary: string | null;
  price_target: string | null;
  insider_buys: number;
  sector: string | null;
  short_days_to_cover: number | null;
  scored?: ScoredCandidate;
};

let editionCongressCache: Record<string, unknown>[] | null = null;

export function resetEditionCongressCache() {
  editionCongressCache = null;
}

async function getEditionCongressTrades(ticker: string): Promise<Record<string, unknown>[]> {
  if (!uwConfigured()) return [];
  if (!editionCongressCache) {
    const { fetchUwCongressTrades } = await import("@/lib/providers/unusual-whales");
    editionCongressCache = (await fetchUwCongressTrades(undefined).catch(() => [])) as Record<string, unknown>[];
  }
  const sym = ticker.toUpperCase();
  return editionCongressCache.filter((t) => String(t.ticker ?? t.symbol ?? "").toUpperCase() === sym).slice(0, 5);
}

function formatAnalyst(recs: Array<Record<string, unknown>> | null): string | null {
  if (!recs?.length) return null;
  const latest = recs[recs.length - 1];
  if (!latest) return null;
  const buy = Number(latest.buy ?? 0);
  const hold = Number(latest.hold ?? 0);
  const sell = Number(latest.sell ?? 0);
  return `Buy ${buy} / Hold ${hold} / Sell ${sell}`;
}

function formatPriceTarget(pt: Record<string, unknown> | null): string | null {
  if (!pt) return null;
  const target = pt.targetMean ?? pt.targetHigh ?? pt.targetMedian;
  if (target == null) return null;
  return `Street PT ~$${Number(target).toFixed(2)}`;
}

const INDEX_IV_PROXY = new Set(["SPX", "SPY", "QQQ", "VIX", "IWM"]);

/** Polygon VIX IV rank for index proxies; UW only as fallback for single names. */
async function resolveIvRank(sym: string): Promise<number | null> {
  if (INDEX_IV_PROXY.has(sym)) {
    const rank = await fetchVixIvRankPercentile().catch(() => null);
    if (rank != null) return rank;
  }
  if (!uwConfigured()) return null;
  const raw = await fetchUwIvRank(sym).catch(() => null);
  return raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
}

async function resolveTickerNews(
  sym: string,
  polyNews: Awaited<ReturnType<typeof fetchPolygonNews>>,
  bzNews: Awaited<ReturnType<typeof fetchBenzingaNews>>,
  fhNews: Awaited<ReturnType<typeof fetchFinnhubCompanyNews>>
): Promise<string[]> {
  const headlines = [
    ...bzNews.map((n) => String(n.title ?? "")),
    ...fhNews.map((n) => String(n.headline ?? n.title ?? "")),
    ...polyNews.map((n) => String(n.title ?? "")),
  ].filter(Boolean);

  if (headlines.length >= 4 || !uwConfigured()) return headlines;

  const uw = await fetchUwNewsHeadlines(sym, 8).catch(() => []);
  return [...headlines, ...uw.map((n) => String(n.title ?? n.headline ?? ""))].filter(Boolean);
}

export async function fetchTickerDossier(ticker: string): Promise<TickerDossier> {
  const sym = ticker.toUpperCase();

  const [
    flowRows,
    darkPool,
    oiChange,
    ivRankRaw,
    flowExpiry,
    positioning,
    tech,
    polyNews,
    bzNews,
    fhNews,
    insider,
    profile,
    shortSi,
    flowStreak,
    analystRecs,
    priceTargetRaw,
    congress,
  ] = await Promise.all([
    fetchMarketFlowAlertRows({ ticker: sym, limit: 80, min_premium: 50_000 }).catch(() => []),
    fetchUwDarkPool(sym).catch(() => null),
    fetchUwOiChange(sym).catch(() => []),
    resolveIvRank(sym),
    fetchUwFlowPerExpiry(sym, 12).catch(() => []),
    fetchPositioningSummary(sym),
    buildTechnicalCard(sym),
    fetchPolygonNews(sym, 8).catch(() => []),
    fetchBenzingaNews(5, { ticker: sym }).catch(() => []),
    fetchFinnhubCompanyNews(sym, 5).catch(() => []),
    fetchFinnhubInsiderTransactions(sym).catch(() => []),
    fetchFinnhubCompanyProfile(sym).catch(() => null),
    fetchShortInterest(sym).catch(() => null),
    fetchTickerFlowStreak(sym),
    fetchFinnhubRecommendations(sym).catch(() => null),
    fetchFinnhubPriceTarget(sym).catch(() => null),
    getEditionCongressTrades(sym),
  ]);

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

  const headlines = await resolveTickerNews(sym, polyNews, bzNews, fhNews);

  const insiderBuys = insider.filter((t) => {
    const tx = String((t as { transactionCode?: string }).transactionCode ?? "").toUpperCase();
    return tx === "P" || tx.includes("BUY");
  }).length;

  const ivRank = ivRankRaw != null && Number.isFinite(ivRankRaw) ? Number(ivRankRaw) : null;

  const dossier: TickerDossier = {
    ticker: sym,
    flows,
    flow_streak: flowStreak,
    strike_stacks: strikeStacks,
    dark_pool: darkPool,
    oi_change: oiChange,
    iv_rank: ivRank,
    iv_term: [],
    realized_vol: null,
    risk_reversal_skew: null,
    flow_by_expiry: flowExpiry,
    positioning,
    congress_trades: congress,
    tech,
    news_headlines: headlines,
    polygon_sentiment: polygonSentiment,
    analyst_summary: formatAnalyst(analystRecs),
    price_target: formatPriceTarget(priceTargetRaw),
    insider_buys: insiderBuys,
    sector: profile ? String((profile as { finnhubIndustry?: string }).finnhubIndustry ?? "") : null,
    short_days_to_cover: shortSi?.days_to_cover ?? null,
  };

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
      insider_buys: insiderBuys,
    },
    flowStreak
  );

  return dossier;
}

export async function fetchAllDossiers(
  tickers: string[],
  batchSize = 4
): Promise<Record<string, TickerDossier>> {
  const out: Record<string, TickerDossier> = {};
  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    const results = await Promise.all(batch.map((t) => fetchTickerDossier(t)));
    for (const d of results) out[d.ticker] = d;
    if (i + batchSize < tickers.length) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return out;
}
