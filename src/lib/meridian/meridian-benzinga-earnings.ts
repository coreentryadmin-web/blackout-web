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
import { recordMeridianEstimateRevision, readRecentMeridianEstimateRevisions } from "@/lib/db";
import {
  buildEarningsWeekAnalytics,
  diffEstimateRevisionTimeline,
  mergeEstimateRevisionTimeline,
} from "@/lib/meridian/meridian-benzinga-analytics";
import {
  buildEarningsWeekRows,
  buildEarningsAnalyticsRows,
  buildRecentEarningsRevisions,
  dedupeEarningsRowsByEvent,
  parseNextEarningsFromBenzinga,
  benzingaTickerWindow,
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
  earnings_analytics_rows: ReturnType<typeof buildEarningsAnalyticsRows>;
  earnings_week_analytics: MeridianEarningsWeekAnalytics | null;
  /** Non-null when the mega-cap week historical-print fetch failed. Empty analytics + null here means no graded history yet. */
  earnings_week_analytics_error: string | null;
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
    const earnings_analytics_rows = buildEarningsAnalyticsRows(window_rows, todayYmd, daysAhead);
    const weekTickers = [...new Set(earnings_week.map((r) => r.ticker))].slice(0, 24);

    let historicalRows: BenzingaStructuredEarnings[] = [];
    let earnings_week_analytics_error: string | null = null;
    if (weekTickers.length) {
      const hist = await fetchBenzingaStructuredEarnings({
        tickers: weekTickers,
        dateLte: todayYmd,
        limit: 100,
        sort: "date.desc",
      }).catch(() => ({
        rows: [] as BenzingaStructuredEarnings[],
        entitled: true,
        error: "cache_error" as const,
      }));
      historicalRows = hist.rows;
      earnings_week_analytics_error = hist.error ?? null;
    }

    // DEDUPE before diffing. The two upstream queries overlap — measured live 2026-08-18, 12 of
    // the 40 revision rows were also in the 360 window rows — and the diff keys its Redis
    // snapshot on (ticker, date). A duplicate therefore re-reads the snapshot the FIRST copy
    // just wrote, so whenever the two copies disagree the second one emits a phantom reversal.
    //
    // That is not hypothetical: production served GRRR `EPS est 0.27 → 0.2` AND
    // `EPS est 0.2 → 0.27` in the SAME payload, with matching revenue entries of −4.3% and
    // +4.5%. A member reads that as the street revising twice in opposite directions within
    // minutes. The two queries are separate HTTP requests, so Benzinga can and does update a row
    // between them; pagination can also repeat a key across pages.
    //
    // Newest `last_updated` wins — the freshest observation is the one worth diffing against.
    const liveRevisions = await diffEstimateRevisionTimeline(
      dedupeEarningsRowsByEvent([...window_rows, ...revisionRes.rows]),
      since
    );
    // Persist every freshly-detected revision (best-effort, matches recordMeridianReportSnapshot's
    // fire-and-forget pattern) and merge with recent persisted history — otherwise this panel is
    // only ever populated in the single ~20-min build that happened to detect each revision. See
    // FINDINGS.md "Estimate-revision timeline is momentary, not cumulative" (2026-08-18).
    for (const entry of liveRevisions) {
      void recordMeridianEstimateRevision(entry);
    }
    const persistedRevisions = await readRecentMeridianEstimateRevisions(since, 24);
    const estimate_revision_timeline = mergeEstimateRevisionTimeline(liveRevisions, persistedRevisions, 24);

    return {
      window_rows,
      earnings_analytics_rows,
      entitled: windowRes.entitled,
      error: windowRes.error,
      earnings_week,
      earnings_week_analytics: buildEarningsWeekAnalytics(earnings_week, historicalRows),
      earnings_week_analytics_error,
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
    earnings_analytics_rows: [],
    earnings_week_analytics: null,
    earnings_week_analytics_error: "cache_error",
    recent_revisions: [],
    estimate_revision_timeline: [],
    after_hours_movers: [],
  }));
}

/** Ticker-scoped Benzinga earnings — upcoming + historical prints for enrichment. */
export async function loadBenzingaTickerEarnings(
  ticker: string,
  eventDate: string | null,
  /** How many PAST prints the caller needs. Drives the lookback window and the row cap. */
  prints = 8
) {
  const sym = ticker.trim().toUpperCase();
  const { lookbackDays, limit } = benzingaTickerWindow(prints);
  const anchor = eventDate ?? new Date().toISOString().slice(0, 10);
  const dateGte = addDaysYmd(anchor, -lookbackDays);
  // The window is part of the identity of this result: two callers wanting different print counts
  // must not share one cache entry, or the first one to arrive decides the sample size for both.
  return serverCache(`meridian:benzinga:ticker:${sym}:${eventDate ?? "next"}:p${prints}`, BENZINGA_TICKER_TTL_MS, async () => {
    const res = await fetchBenzingaStructuredEarnings({
      ticker: sym,
      dateGte,
      limit,
      sort: "date.desc",
    });
    // THROW on a failed fetch so the cache stores NOTHING.
    //
    // Measured 2026-08-18: every Benzinga-derived enrichment field was empty on 8/8 mega-caps
    // — print_history, street_estimates, earnings_calendar, beat_rates — while the same
    // payload's pack.history carried 4 prints. A failure returned `{rows: []}` and got cached
    // for ten minutes, so ONE bad request became ten minutes of "this company has no earnings
    // history" on every panel fed from here.
    //
    // An entitled-but-genuinely-empty result (no error, no rows) is a real answer and still
    // caches — the distinction is exactly the one the old code collapsed.
    if (res.error) throw new Error(`benzinga_ticker_earnings:${res.error}`);
    return res;
  }).catch((e: unknown) => ({
    rows: [] as Awaited<ReturnType<typeof fetchBenzingaStructuredEarnings>>["rows"],
    entitled: true,
    // Carried, not swallowed: callers surface this so an outage cannot render as "no data".
    error: String(e instanceof Error ? e.message : e).slice(0, 200),
  }));
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
  // This only reads the NEXT (future) row, so it needs no past-print depth — 2 keeps the window
  // tight while the row cap still covers Benzinga's projected tail.
  const res = await loadBenzingaTickerEarnings(sym, null, 2);
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
