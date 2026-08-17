import "server-only";

import {
  fetchBenzingaAfterHoursMovers,
  fetchBenzingaCorporateGuidance,
  fetchBenzingaNews,
  fetchBenzingaStructuredEarnings,
  parsePriceTargetFromText,
  type BenzingaStructuredEarnings,
} from "@/lib/providers/polygon";
import { serverCache } from "@/lib/server-cache";
import {
  buildEarningsWeekAnalytics,
  diffEstimateRevisionTimeline,
} from "@/lib/meridian/meridian-benzinga-analytics";
import {
  buildEarningsWeekRows,
  buildRecentEarningsRevisions,
  parseNextEarningsFromBenzinga,
} from "@/lib/meridian/meridian-benzinga-earnings-core";
import { todayEtYmd } from "@/lib/providers/spx-session";
import type { NextEarnings } from "@/lib/providers/uw-earnings";
import type {
  MeridianAfterHoursMover,
  MeridianEarningsWeekAnalytics,
  MeridianEstimateRevisionEntry,
} from "@/features/meridian/lib/meridian-types";

const BENZINGA_TIMELINE_TTL_MS = 20 * 60 * 1000;
const BENZINGA_TICKER_TTL_MS = 10 * 60 * 1000;
const REVISION_LOOKBACK_HOURS = 36;

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function revisionSinceIso(): string {
  return new Date(Date.now() - REVISION_LOOKBACK_HOURS * 3_600_000).toISOString();
}

export type BenzingaEarningsBundle = {
  window_rows: BenzingaStructuredEarnings[];
  entitled: boolean;
  error: string | null;
  earnings_week: ReturnType<typeof buildEarningsWeekRows>;
  earnings_week_analytics: MeridianEarningsWeekAnalytics | null;
  recent_revisions: ReturnType<typeof buildRecentEarningsRevisions>;
  estimate_revision_timeline: MeridianEstimateRevisionEntry[];
  after_hours_movers: MeridianAfterHoursMover[];
};

/** Market-wide Benzinga earnings rows for the Meridian timeline window (paginated). */
export async function loadBenzingaEarningsBundle(
  todayYmd: string,
  daysAhead: number
): Promise<BenzingaEarningsBundle> {
  const dateLte = addDaysYmd(todayYmd, Math.max(1, daysAhead));
  const cacheKey = `meridian:benzinga:bundle:v2:${todayYmd}:${daysAhead}`;
  return serverCache(cacheKey, BENZINGA_TIMELINE_TTL_MS, async () => {
    const since = revisionSinceIso();
    const [windowRes, revisionRes, ahMovers] = await Promise.all([
      fetchBenzingaStructuredEarnings({
        dateGte: todayYmd,
        dateLte,
        limit: 120,
        sort: "date.asc",
        paginate: true,
      }),
      fetchBenzingaStructuredEarnings({
        lastUpdatedGte: since,
        importanceGte: 3,
        limit: 40,
        sort: "last_updated.desc",
      }),
      fetchBenzingaAfterHoursMovers(14).catch(() => []),
    ]);

    const window_rows = windowRes.rows;
    const earnings_week = buildEarningsWeekRows(window_rows, todayYmd, daysAhead);
    const weekTickers = [...new Set(earnings_week.map((r) => r.ticker))].slice(0, 24);

    let historicalRows: BenzingaStructuredEarnings[] = [];
    if (weekTickers.length) {
      const hist = await fetchBenzingaStructuredEarnings({
        tickers: weekTickers,
        dateLte: todayYmd,
        limit: 100,
        sort: "date.desc",
      }).catch(() => ({ rows: [] as BenzingaStructuredEarnings[] }));
      historicalRows = hist.rows;
    }

    const revisionUnion = [...window_rows, ...revisionRes.rows];
    const estimate_revision_timeline = await diffEstimateRevisionTimeline(revisionUnion, since);

    return {
      window_rows,
      entitled: windowRes.entitled,
      error: windowRes.error,
      earnings_week,
      earnings_week_analytics: buildEarningsWeekAnalytics(earnings_week, historicalRows),
      recent_revisions: buildRecentEarningsRevisions(revisionRes.rows, since),
      estimate_revision_timeline,
      after_hours_movers: ahMovers.map((m) => ({
        title: m.title,
        channel: m.channel || null,
        published: m.published || null,
      })),
    };
  }).catch(() => ({
    window_rows: [],
    entitled: true,
    error: "cache_error",
    earnings_week: [],
    earnings_week_analytics: null,
    recent_revisions: [],
    estimate_revision_timeline: [],
    after_hours_movers: [],
  }));
}

/** Ticker-scoped Benzinga earnings — upcoming + historical prints for enrichment. */
export async function loadBenzingaTickerEarnings(ticker: string, eventDate: string | null) {
  const sym = ticker.trim().toUpperCase();
  const dateGte = eventDate ? addDaysYmd(eventDate, -420) : addDaysYmd(new Date().toISOString().slice(0, 10), -420);
  return serverCache(`meridian:benzinga:ticker:${sym}:${eventDate ?? "next"}`, BENZINGA_TICKER_TTL_MS, async () => {
    const res = await fetchBenzingaStructuredEarnings({
      ticker: sym,
      dateGte,
      limit: 16,
      sort: "date.desc",
    });
    return res;
  }).catch(() => ({ rows: [], entitled: true, error: "cache_error" }));
}

/** Board tickers batch — fills gaps the market-wide window may miss. */
export async function loadBenzingaBoardEarnings(tickers: string[], todayYmd: string, daysAhead: number) {
  const uniq = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))].slice(0, 24);
  if (!uniq.length) return { rows: [], entitled: true, error: null };
  const dateLte = addDaysYmd(todayYmd, Math.max(1, daysAhead));
  return serverCache(`meridian:benzinga:board:${uniq.join(",")}:${todayYmd}`, BENZINGA_TICKER_TTL_MS, () =>
    fetchBenzingaStructuredEarnings({
      tickers: uniq,
      dateGte: todayYmd,
      dateLte,
      limit: 60,
      sort: "date.asc",
    })
  ).catch(() => ({ rows: [], entitled: true, error: "cache_error" }));
}

export async function loadBenzingaTickerGuidance(ticker: string) {
  const sym = ticker.trim().toUpperCase();
  const yearAgo = addDaysYmd(new Date().toISOString().slice(0, 10), -400);
  return serverCache(`meridian:benzinga:guidance:${sym}`, BENZINGA_TICKER_TTL_MS, () =>
    fetchBenzingaCorporateGuidance({ ticker: sym, dateGte: yearAgo, limit: 6 })
  ).catch(() => ({ rows: [], entitled: false, error: "cache_error" }));
}

/** Next earnings date from Benzinga structured calendar (Meridian/Largo — no UW REST). */
export async function loadNextEarningsFromBenzinga(ticker: string): Promise<NextEarnings | null> {
  const sym = ticker.trim().toUpperCase();
  const today = todayEtYmd();
  const res = await loadBenzingaTickerEarnings(sym, null);
  return parseNextEarningsFromBenzinga(sym, res.rows, today);
}

/** Per-ticker estimate revision timeline (cached snapshot diff). */
export async function loadTickerEstimateRevisions(
  ticker: string,
  rows: BenzingaStructuredEarnings[]
): Promise<MeridianEstimateRevisionEntry[]> {
  const since = revisionSinceIso();
  return diffEstimateRevisionTimeline(rows, since);
}
