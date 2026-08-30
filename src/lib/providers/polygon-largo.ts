/**
 * Extended Polygon/Massive endpoints for Largo terminal.
 * Primary data source — unlimited calls on paid plan.
 */
import { polygonTrackedFetch, isPolygonCircuitOpen } from "./polygon-rate-limiter";
import { polygonConfigured } from "./config";
import { priorEtYmd, todayEtYmd } from "./spx-session";
import { recordDataSourceing } from "@/features/nighthawk/lib/diagnostics";
import { stampBars } from "@/lib/largo/temporal/bar-session-date";

// Primary/fallback URL failover: when the circuit breaker trips (5 consecutive 429s),
// switch to the fallback URL so requests aren't blocked for the full pause window.
// Mirrors the pattern in scripts/audit/zerodte-e2e-suite.mjs (data-resilience audit 2026-07-27).
const POLYGON_PRIMARY = (process.env.POLYGON_API_BASE ?? "https://api.massive.com").replace(/\/$/, "");
const POLYGON_FALLBACK = (() => {
  try { return new URL(POLYGON_PRIMARY).hostname === "api.polygon.io" || new URL(POLYGON_PRIMARY).hostname.endsWith(".polygon.io"); }
  catch { return false; }
})()
  ? "https://api.massive.com"
  : "https://api.polygon.io";
/** Sticky: once we fail over, stay on the fallback until the breaker resets. */
let _usingFallback = false;
let _lastBreakerCheck = false;

function getPolygonBase(): string {
  const breakerOpen = isPolygonCircuitOpen();
  // Transition: breaker just opened → switch to fallback
  if (breakerOpen && !_lastBreakerCheck) {
    _usingFallback = true;
    console.warn(`[polygon-largo] Circuit breaker open — failing over to ${POLYGON_FALLBACK}`);
  }
  // Transition: breaker just closed → try primary again
  if (!breakerOpen && _lastBreakerCheck) {
    _usingFallback = false;
    console.warn(`[polygon-largo] Circuit breaker reset — returning to primary ${POLYGON_PRIMARY}`);
  }
  _lastBreakerCheck = breakerOpen;
  return _usingFallback ? POLYGON_FALLBACK : POLYGON_PRIMARY;
}

const KEY = process.env.POLYGON_API_KEY ?? "";

/** Optional Next/fetch cache override for call sites that must not force dynamic rendering (e.g. marketing ISR). */
export type PolygonLargoFetchInit = Pick<RequestInit, "cache"> & {
  next?: { revalidate?: number };
};

export type AggBar = { t?: number; o: number; h: number; l: number; c: number; v?: number };

/**
 * `onFailure` is an additive diagnostic hook — optional, defaults to a no-op — so every existing
 * caller of `polygonGet` (there are many in this file) keeps its exact current behavior: null on
 * any failure, nothing more. It exists because that failure mode used to be COMPLETELY invisible
 * outside a `console.warn` server logs nobody reads: not configured, a circuit-breaker-open throw
 * (`polygonTrackedFetch` DOES throw when the breaker is open — see polygon-rate-limiter.ts — but
 * this function's own try/catch swallowed that throw into the same bare `null` as a plain HTTP
 * 404), a non-2xx status, or a network error were all indistinguishable to any caller. A caller
 * that actually needs to know WHY (see `fetchAggBarsWithDiagnostics` below) can now find out
 * without this function's plain callers changing at all.
 */
async function polygonGet<T>(
  path: string,
  params: Record<string, string> = {},
  onFailure?: (reason: string) => void,
  fetchInit?: PolygonLargoFetchInit
): Promise<T | null> {
  if (!polygonConfigured()) {
    onFailure?.("Polygon not configured (missing POLYGON_API_KEY)");
    return null;
  }
  const qs = new URLSearchParams({ ...params, apiKey: KEY });
  try {
    // `cache` and `next.revalidate` are mutually exclusive to Next's fetch patch — passing both
    // leaves `cache: "no-store"` in effect and next.revalidate does nothing (measured live
    // 2026-08-30: the #3187 "fix" that spread `...fetchInit` AFTER a hardcoded `cache: "no-store"`
    // shipped, deployed, and the exact "Page changed from static to dynamic" error it was meant to
    // close kept firing in production, because a spread only overrides `cache` when `fetchInit`
    // itself sets `cache` — this caller only ever sets `next`). So build the two shapes distinctly
    // instead of spreading a partial override onto a fixed default.
    const cacheInit: RequestInit = fetchInit?.next
      ? { headers: { Accept: "application/json" }, next: fetchInit.next }
      : { headers: { Accept: "application/json" }, cache: fetchInit?.cache ?? "no-store" };
    const res = await polygonTrackedFetch(path, `${getPolygonBase()}${path}?${qs}`, cacheInit);
    if (!res.ok) {
      console.warn(`[polygon-largo] ${path.replace(/[\r\n]/g, "")} returned ${res.status}`);
      onFailure?.(`HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).replace(/[\r\n]/g, "");
    console.warn(`[polygon-largo] ${path.replace(/[\r\n]/g, "")} failed: ${msg}`);
    onFailure?.(msg);
    return null;
  }
}

function mapBars(results: Array<Record<string, unknown>> | undefined): AggBar[] {
  return (results ?? []).map((r) => ({
    t: Number(r.t),
    o: Number(r.o),
    h: Number(r.h),
    l: Number(r.l),
    c: Number(r.c),
    v: r.v != null ? Number(r.v) : undefined,
  }));
}

export async function fetchAggBars(
  symbol: string,
  multiplier: number,
  timespan: "minute" | "hour" | "day" | "week",
  from: string,
  to: string,
  limit = "500"
): Promise<AggBar[]> {
  const sym = symbol.toUpperCase();
  const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
    `/v2/aggs/ticker/${sym}/range/${multiplier}/${timespan}/${from}/${to}`,
    { limit, sort: "asc" }
  );
  return mapBars(data?.results);
}

/**
 * Same call as {@link fetchAggBars}, plus WHY it came back empty when it did — not configured,
 * an HTTP status, a thrown error (circuit breaker open, network failure), or null (a genuinely
 * empty `results` array: the request succeeded and Polygon just had nothing for that range).
 * Built for `skip-grading.ts`'s counterfactual grader, which used to report every empty result
 * as the same generic "no bar data" regardless of cause (2026-08-29 audit finding) — a live run
 * showed 100% of graded rejections landing on that one reason, and there was no way to tell a
 * real Polygon gap from the circuit breaker being open from a bug, without this.
 */
export async function fetchAggBarsWithDiagnostics(
  symbol: string,
  multiplier: number,
  timespan: "minute" | "hour" | "day" | "week",
  from: string,
  to: string,
  limit = "500"
): Promise<{ bars: AggBar[]; failureReason: string | null }> {
  const sym = symbol.toUpperCase();
  let failureReason: string | null = null;
  const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
    `/v2/aggs/ticker/${sym}/range/${multiplier}/${timespan}/${from}/${to}`,
    { limit, sort: "asc" },
    (reason) => {
      failureReason = reason;
    }
  );
  // data === null means polygonGet itself failed (onFailure already ran); data present but
  // results empty/absent is a genuinely empty range, not a failure — never conflate the two.
  return { bars: mapBars(data?.results), failureReason: data == null ? failureReason : null };
}

export async function fetchPreviousDayBar(
  symbol: string,
  fetchInit?: PolygonLargoFetchInit
): Promise<AggBar | null> {
  const sym = symbol.toUpperCase();
  const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
    `/v2/aggs/ticker/${sym}/prev`,
    {},
    undefined,
    fetchInit
  );
  const row = data?.results?.[0];
  if (!row) return null;
  return {
    t: Number(row.t),
    o: Number(row.o),
    h: Number(row.h),
    l: Number(row.l),
    c: Number(row.c),
    v: row.v != null ? Number(row.v) : undefined,
  };
}

type IndicatorBlock = { values?: Array<{ value?: number; timestamp?: number }> };

async function latestIndicator(path: string, params: Record<string, string>): Promise<number | null> {
  const data = await polygonGet<{ results?: IndicatorBlock }>(path, {
    ...params,
    order: "desc",
    limit: "1",
    series_type: "close",
  });
  const v = data?.results?.values?.[0]?.value;
  return v != null ? Number(v) : null;
}

export async function fetchPolygonMacd(
  symbol: string,
  timespan: "minute" | "hour" | "day" = "day"
) {
  const sym = symbol.toUpperCase();
  const data = await polygonGet<{
    results?: {
      values?: Array<{ value?: number; signal?: number; histogram?: number }>;
    };
  }>(`/v1/indicators/macd/${sym}`, {
    timespan,
    short_window: "12",
    long_window: "26",
    signal_window: "9",
    order: "desc",
    limit: "1",
    series_type: "close",
  });
  const row = data?.results?.values?.[0];
  if (!row) return null;
  return {
    macd: Number(row.value ?? 0),
    signal: Number(row.signal ?? 0),
    histogram: Number(row.histogram ?? 0),
  };
}

export async function fetchPolygonRsi(
  symbol: string,
  window = 14,
  timespan: "minute" | "hour" | "day" = "day"
) {
  return latestIndicator(`/v1/indicators/rsi/${symToPath(symbol)}`, {
    window: String(window),
    timespan,
  });
}

export async function fetchPolygonEma(
  symbol: string,
  window: number,
  timespan: "minute" | "hour" | "day" = "day"
) {
  return latestIndicator(`/v1/indicators/ema/${symToPath(symbol)}`, {
    window: String(window),
    timespan,
  });
}

export async function fetchPolygonSma(
  symbol: string,
  window: number,
  timespan: "minute" | "hour" | "day" = "day"
) {
  return latestIndicator(`/v1/indicators/sma/${symToPath(symbol)}`, {
    window: String(window),
    timespan,
  });
}

function symToPath(symbol: string): string {
  return symbol.toUpperCase();
}

export async function fetchPolygonTickerDetails(ticker: string) {
  return polygonGet<Record<string, unknown>>(`/v3/reference/tickers/${ticker.toUpperCase()}`, {});
}

export async function fetchPolygonNews(ticker: string, limit = 15) {
  const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
    "/v2/reference/news",
    { ticker: ticker.toUpperCase(), limit: String(limit), order: "desc", sort: "published_utc" }
  );
  return (data?.results ?? []).map((a) => {
    const insights = Array.isArray(a.insights)
      ? (a.insights as Array<Record<string, unknown>>).map((i) => ({
          ticker: String(i.ticker ?? ""),
          sentiment: String(i.sentiment ?? ""),
          reasoning: String(i.sentiment_reasoning ?? "").slice(0, 200),
        }))
      : [];
    return {
      title: String(a.title ?? ""),
      author: String(a.author ?? ""),
      published: String(a.published_utc ?? ""),
      description: String(a.description ?? "").slice(0, 400),
      url: String(a.article_url ?? ""),
      tickers: Array.isArray(a.tickers) ? a.tickers.map(String) : [],
      keywords: Array.isArray(a.keywords) ? a.keywords.map(String) : [],
      insights,
      publisher: (a.publisher as Record<string, unknown>)?.name ?? "",
    };
  });
}

export function computeLevelsFromBars(bars: AggBar[], price: number) {
  if (!bars.length) return { support: null, resistance: null, vwap: null, trend: "unknown" as const };

  let pv = 0;
  let vol = 0;
  for (const b of bars) {
    const v = b.v ?? 0;
    const tp = (b.h + b.l + b.c) / 3;
    pv += tp * v;
    vol += v;
  }
  const vwap = vol > 0 ? Number((pv / vol).toFixed(2)) : null;

  const highs = bars.map((b) => b.h);
  const lows = bars.map((b) => b.l);
  const resistance = Math.max(...highs.slice(-20));
  const support = Math.min(...lows.slice(-20));

  const emaProxy = bars.slice(-20).reduce((s, b) => s + b.c, 0) / Math.min(20, bars.length);
  const trend = price > emaProxy ? ("bullish" as const) : price < emaProxy ? ("bearish" as const) : ("flat" as const);

  return {
    support: Number(support.toFixed(2)),
    resistance: Number(resistance.toFixed(2)),
    vwap,
    trend,
  };
}

/** Full multi-timeframe technical snapshot — Polygon primary. */
export async function fetchPolygonMtfTechnicals(ticker: string) {
  const sym = ticker.toUpperCase();
  const isIndex = sym === "SPX" || sym === "VIX" || sym.startsWith("I:");
  const polygonSym = sym === "SPX" ? "I:SPX" : sym === "VIX" ? "I:VIX" : sym;

  const today = todayEtYmd();
  const fromDaily = priorEtYmd(120);
  const fromHour = priorEtYmd(30);
  const fromMin = today;

  const [daily, hourly, minute15, prevDay, lastTrade, lastNbbo] = await Promise.all([
    fetchAggBars(polygonSym, 1, "day", fromDaily, today, "120"),
    fetchAggBars(polygonSym, 1, "hour", fromHour, today, "500"),
    fetchAggBars(polygonSym, 15, "minute", fromMin, today, "500"),
    fetchPreviousDayBar(polygonSym),
    fetchStockLastTrade(polygonSym),
    fetchStockLastNbbo(polygonSym),
  ]);

  // Off-hours price fallback chain: daily → hourly → last trade → last NBBO → prior close
  // Record attempts for diagnostics so we know which source provided the final price
  const priceAttempts = [
    { source: "daily_close", ok: !!daily.at(-1)?.c, value: daily.at(-1)?.c ?? null },
    { source: "hourly_close", ok: !!hourly.at(-1)?.c, value: hourly.at(-1)?.c ?? null },
    { source: "last_trade", ok: lastTrade?.p != null, value: lastTrade?.p != null ? Number(lastTrade.p) : null },
    {
      source: "last_nbbo_mid",
      ok: lastNbbo != null && typeof lastNbbo.ask === "number" && typeof lastNbbo.bid === "number",
      value: lastNbbo != null && typeof lastNbbo.ask === "number" && typeof lastNbbo.bid === "number"
        ? (lastNbbo.ask + lastNbbo.bid) / 2
        : null,
    },
    { source: "prior_day_close", ok: !!prevDay?.c, value: prevDay?.c ?? null },
  ];

  let price =
    daily.at(-1)?.c ??
    hourly.at(-1)?.c ??
    (lastTrade?.p != null ? Number(lastTrade.p) : null) ??
    (lastNbbo != null && typeof lastNbbo.ask === "number" && typeof lastNbbo.bid === "number"
      ? (lastNbbo.ask + lastNbbo.bid) / 2
      : null) ??
    prevDay?.c ??
    0;

  // Record which price source was used
  const priceSource = priceAttempts.find(a => a.ok);
  recordDataSourceing(sym, "price_resolution", priceAttempts, price, !priceSource && price === 0 ? "FALLBACK: Using 0 as ultimate default" : undefined);

  const [ema20d, ema50d, ema200d, rsi14d, macdD, ema20h, rsi14h, ema20m, rsi14m] = await Promise.all([
    fetchPolygonEma(polygonSym, 20, "day"),
    fetchPolygonEma(polygonSym, 50, "day"),
    fetchPolygonEma(polygonSym, 200, "day"),
    fetchPolygonRsi(polygonSym, 14, "day"),
    fetchPolygonMacd(polygonSym, "day"),
    fetchPolygonEma(polygonSym, 20, "hour"),
    fetchPolygonRsi(polygonSym, 14, "hour"),
    fetchPolygonEma(polygonSym, 20, "minute"),
    fetchPolygonRsi(polygonSym, 14, "minute"),
  ]);

  // Record technical indicator sourcing
  const technicalAttempts = [
    { source: "ema20_daily", ok: ema20d != null, value: ema20d },
    { source: "ema50_daily", ok: ema50d != null, value: ema50d },
    { source: "ema200_daily", ok: ema200d != null, value: ema200d },
    { source: "rsi14_daily", ok: rsi14d != null, value: rsi14d },
    { source: "macd_daily", ok: macdD != null, value: macdD },
    { source: "ema20_hourly", ok: ema20h != null, value: ema20h },
    { source: "rsi14_hourly", ok: rsi14h != null, value: rsi14h },
    { source: "ema20_15m", ok: ema20m != null, value: ema20m },
    { source: "rsi14_15m", ok: rsi14m != null, value: rsi14m },
  ];
  const missingIndicators = technicalAttempts.filter(a => !a.ok).map(a => a.source);
  recordDataSourceing(sym, "technical_indicators", technicalAttempts, { ema20d, ema50d, ema200d, rsi14d, macdD, ema20h, rsi14h, ema20m, rsi14m }, missingIndicators.length > 0 ? `Missing indicators: ${missingIndicators.join(", ")}` : undefined);

  const dailyLv = computeLevelsFromBars(daily, price);
  const hourlyLv = computeLevelsFromBars(hourly, price);
  const minLv = computeLevelsFromBars(minute15, price);

  // ATR14 fallback: daily (preferred) → hourly (off-hours) → prevDay range proxy
  let atr14: number | null = null;
  const computeAtrFromBars = (bars: AggBar[], window = 14): number | null => {
    if (bars.length < window) return null;
    const trs: number[] = [];
    for (let i = 1; i < bars.length; i++) {
      const cur = bars[i]!;
      const prev = bars[i - 1]!;
      trs.push(Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c)));
    }
    return Number((trs.slice(-window).reduce((a, b) => a + b, 0) / window).toFixed(2));
  };

  // Record ATR14 sourcing attempts
  const atrAttempts = [
    { source: "daily_bars_atr14", ok: daily.length >= 14, value: computeAtrFromBars(daily) },
    { source: "hourly_bars_atr14", ok: hourly.length >= 14, value: computeAtrFromBars(hourly) },
  ];

  atr14 = computeAtrFromBars(daily) ?? computeAtrFromBars(hourly);
  // Off-hours fallback: if hourly data insufficient, estimate ATR from prior day's range
  if (!atr14 && prevDay) {
    const prevRange = prevDay.h - prevDay.l;
    atr14 = Number(prevRange.toFixed(2));
    atrAttempts.push({ source: "prior_day_range_estimate", ok: true, value: atr14 });
  }

  recordDataSourceing(sym, "atr14_resolution", atrAttempts, atr14, !atr14 ? "CRITICAL: ATR14 unavailable at all fallback tiers" : undefined);

  const trendStack =
    price > (ema20d ?? 0) && (ema20d ?? 0) > (ema50d ?? 0)
      ? "bullish"
      : price < (ema20d ?? 0) && (ema20d ?? 0) < (ema50d ?? 0)
        ? "bearish"
        : "mixed";

  const rangeHigh20 = daily.length ? Math.max(...daily.slice(-20).map((b) => b.h)) : null;
  const rangeLow20 = daily.length ? Math.min(...daily.slice(-20).map((b) => b.l)) : null;
  const weekSlice = daily.slice(-5);
  const monthSlice = daily.slice(-22);

  const priorVols = daily
    .slice(-21, -1)
    .map((b) => b.v ?? 0)
    .filter((v) => v > 0);
  const todayVol = daily.at(-1)?.v ?? prevDay?.v ?? 0;
  const avgVol20 =
    priorVols.length >= 5 ? priorVols.reduce((sum, v) => sum + v, 0) / priorVols.length : null;
  const rel_volume =
    avgVol20 != null && avgVol20 > 0 && todayVol > 0
      ? Number((todayVol / avgVol20).toFixed(2))
      : null;

  return {
    ticker: polygonSym,
    price,
    is_index: isIndex,
    trend_stack: trendStack,
    atr14,
    rel_volume,
    // Stamped, not bare. Unlabelled, this array is the single worst offender in the whole tool
    // surface: asked for a named past date, the model picked `daily_bars[0]` — the OLDEST bar in a
    // 60-session window — and reported its close as the answer, citing t=1779858000000 (2026-05-27)
    // for a question about 2026-08-17. A bar that carries its own session date can be selected BY
    // that date instead of by position.
    daily_bars: stampBars(daily.slice(-60), "day"),
    prev_day: prevDay
      ? { open: prevDay.o, high: prevDay.h, low: prevDay.l, close: prevDay.c, volume: prevDay.v }
      : null,
    emas: { ema20: ema20d, ema50: ema50d, ema200: ema200d },
    rsi: { daily: rsi14d, hourly: rsi14h, m15: rsi14m },
    macd: { daily: macdD },
    timeframes: {
      daily: { ...dailyLv, ema20: ema20d, rsi14: rsi14d },
      hourly: { ...hourlyLv, ema20: ema20h, rsi14: rsi14h },
      m15: { ...minLv, ema20: ema20m, rsi14: rsi14m },
    },
    range_high_20d: rangeHigh20,
    range_low_20d: rangeLow20,
    weekly: {
      high: weekSlice.length ? Math.max(...weekSlice.map((b) => b.h)) : null,
      low: weekSlice.length ? Math.min(...weekSlice.map((b) => b.l)) : null,
      support: weekSlice.length ? Number(Math.min(...weekSlice.map((b) => b.l)).toFixed(2)) : null,
      resistance: weekSlice.length ? Number(Math.max(...weekSlice.map((b) => b.h)).toFixed(2)) : null,
    },
    monthly: {
      high: monthSlice.length ? Math.max(...monthSlice.map((b) => b.h)) : null,
      low: monthSlice.length ? Math.min(...monthSlice.map((b) => b.l)) : null,
      support: monthSlice.length ? Number(Math.min(...monthSlice.map((b) => b.l)).toFixed(2)) : null,
      resistance: monthSlice.length ? Number(Math.max(...monthSlice.map((b) => b.h)).toFixed(2)) : null,
    },
    data_source: "polygon",
  };
}

export async function fetchStockLastNbbo(ticker: string) {
  const sym = ticker.toUpperCase().replace(/^I:/, "");
  const data = await polygonGet<{ results?: Record<string, unknown> }>(`/v2/last/nbbo/${sym}`, {});
  return data?.results ?? null;
}

export async function fetchStockLastTrade(ticker: string) {
  const sym = ticker.toUpperCase().replace(/^I:/, "");
  const data = await polygonGet<{ results?: Record<string, unknown> }>(`/v2/last/trade/${sym}`, {});
  return data?.results ?? null;
}

export async function fetchOpenClose(ticker: string, date?: string) {
  const sym = ticker.toUpperCase().replace(/^I:/, "");
  const d = date ?? priorEtYmd();
  return polygonGet<Record<string, unknown>>(`/v1/open-close/${sym}/${d}`, {});
}

export async function fetchMarketUpcomingStatus() {
  return polygonGet<Record<string, unknown>>("/v1/marketstatus/upcoming", {});
}

export async function fetchPolygonMarketNews(limit = 15) {
  const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>("/v2/reference/news", {
    limit: String(limit),
    order: "desc",
    sort: "published_utc",
  });
  return (data?.results ?? []).map((a) => ({
    title: String(a.title ?? ""),
    published: String(a.published_utc ?? ""),
    description: String(a.description ?? "").slice(0, 300),
    tickers: Array.isArray(a.tickers) ? a.tickers.map(String) : [],
    url: String(a.article_url ?? ""),
  }));
}

export async function fetchRelatedTickers(ticker: string) {
  const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
    `/v3/reference/tickers/${ticker.toUpperCase()}/related`,
    {}
  );
  return data?.results ?? [];
}

export async function fetchStockFloat(ticker: string) {
  return polygonGet<Record<string, unknown>>(`/stocks/v1/float`, { ticker: ticker.toUpperCase() });
}

// ── Ticker search ─────────────────────────────────────────────────────────────

export type TickerSearchResult = {
  ticker: string;
  name: string;
  market: string;
  primary_exchange: string;
  type: string;
  active: boolean;
  currency_name: string;
};

/** True when the query looks like a ticker symbol (not a company-name fragment). */
export function isTickerSymbolQuery(query: string): boolean {
  return /^[A-Z0-9.\-]{1,8}$/i.test(query.trim());
}

function mapPolygonTickerRef(r: Record<string, unknown>): TickerSearchResult | null {
  const ticker = String(r.ticker ?? "").trim();
  if (!ticker) return null;
  return {
    ticker,
    name: String(r.name ?? ""),
    market: String(r.market ?? ""),
    primary_exchange: String(r.primary_exchange ?? ""),
    type: String(r.type ?? ""),
    active: r.active !== false,
    currency_name: String(r.currency_name ?? "usd"),
  };
}

/**
 * Relevance rank for a ticker-search hit against the typed query — LOWER sorts first.
 * Polygon's `/v3/reference/tickers?search=` fuzzy-matches ticker AND name, but the only
 * sort it offers is alphabetical by ticker (`sort=ticker`), not relevance. So an exact
 * ticker match (e.g. "PLTR") can sort well past leveraged/derivative products whose
 * NAME merely mentions it ("PLA" GraniteShares Autocallable PLTR ETF, "I:PLTRCW" index,
 * "PLTA"/"PLTD"/"PLTG" leveraged single-stock ETFs) because their tickers happen to sort
 * alphabetically earlier. With a small page size (Thermal's search dropdown asks for
 * limit=8) the real underlying can be pushed off the page entirely — confirmed live for
 * "PLTR" (see FINDINGS 2026-08-03: I:PLTRCW/PLA/PLIB/PLTA/PLTD/PLTG filled all 8 slots,
 * the actual PLTR common stock never appeared).
 */
function tickerSearchRank(r: TickerSearchResult, queryUpper: string): number {
  const tickerUpper = r.ticker.toUpperCase();
  if (tickerUpper === queryUpper) return 0;
  if (tickerUpper.startsWith(queryUpper)) return r.market === "stocks" && r.type === "CS" ? 1 : 2;
  return r.market === "stocks" && r.type === "CS" ? 3 : 4;
}

/** Re-rank Polygon's alphabetical hits by relevance to `query`, stable within each rank tier. */
export function rankTickerSearchResults(
  results: TickerSearchResult[],
  query: string
): TickerSearchResult[] {
  const queryUpper = query.trim().toUpperCase();
  return results
    .map((r, index) => ({ r, index, rank: tickerSearchRank(r, queryUpper) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ r }) => r);
}

export async function fetchPolygonTickerSearch(query: string, limit = 10): Promise<TickerSearchResult[]> {
  const queryUpper = query.trim().toUpperCase();
  // Over-fetch upstream so the exact/prefix match has room to surface after re-ranking —
  // Polygon returns alphabetical-by-ticker, so the real match can sit outside a `limit`-sized
  // page of purely alphabetical results (see rankTickerSearchResults doc above).
  const upstreamLimit = Math.min(Math.max(limit * 5, 25), 50);
  const [data, directPayload] = await Promise.all([
    polygonGet<{ results?: Array<Record<string, unknown>> }>(
      "/v3/reference/tickers",
      { search: query, active: "true", limit: String(upstreamLimit), sort: "ticker", order: "asc" }
    ),
    isTickerSymbolQuery(queryUpper)
      ? fetchPolygonTickerDetails(queryUpper).catch(() => null)
      : Promise.resolve(null),
  ]);
  const mapped = (data?.results ?? [])
    .map((r) => mapPolygonTickerRef(r))
    .filter((r): r is TickerSearchResult => r != null);

  const directRow =
    directPayload && typeof directPayload === "object"
      ? mapPolygonTickerRef((directPayload as { results?: Record<string, unknown> }).results ?? {})
      : null;
  const directHit = directRow?.active === true ? directRow : null;
  const merged =
    directHit != null
      ? [directHit, ...mapped.filter((r) => r.ticker.toUpperCase() !== directHit.ticker.toUpperCase())]
      : mapped;

  return rankTickerSearchResults(merged, query).slice(0, limit);
}

// ── Options OHLC bars ─────────────────────────────────────────────────────────

export async function fetchPolygonOptionBars(
  optionTicker: string,
  multiplier: number,
  timespan: "minute" | "hour" | "day",
  from: string,
  to: string,
  limit = "250"
): Promise<AggBar[]> {
  const sym = optionTicker.startsWith("O:") ? optionTicker : `O:${optionTicker}`;
  const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
    `/v2/aggs/ticker/${sym}/range/${multiplier}/${timespan}/${from}/${to}`,
    { limit, sort: "asc", adjusted: "true" }
  );
  return mapBars(data?.results);
}

// ── Dividends & splits ────────────────────────────────────────────────────────

export type DividendRecord = {
  ticker: string;
  ex_dividend_date: string;
  pay_date: string;
  record_date: string;
  frequency: number;
  cash_amount: number;
  currency: string;
};

export async function fetchPolygonDividends(ticker: string): Promise<DividendRecord[]> {
  const sym = ticker.toUpperCase();
  const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
    "/v3/reference/dividends",
    { ticker: sym, limit: "8", order: "desc", sort: "ex_dividend_date" }
  );
  return (data?.results ?? []).map((r) => ({
    ticker: String(r.ticker ?? sym),
    ex_dividend_date: String(r.ex_dividend_date ?? ""),
    pay_date: String(r.pay_date ?? ""),
    record_date: String(r.record_date ?? ""),
    frequency: Number(r.frequency ?? 0),
    cash_amount: Number(r.cash_amount ?? 0),
    currency: String(r.currency ?? "USD"),
  }));
}

export type SplitRecord = {
  ticker: string;
  execution_date: string;
  split_from: number;
  split_to: number;
};

export async function fetchPolygonSplits(ticker: string): Promise<SplitRecord[]> {
  const sym = ticker.toUpperCase();
  const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
    "/v3/reference/splits",
    { ticker: sym, limit: "5", order: "desc", sort: "execution_date" }
  );
  return (data?.results ?? []).map((r) => ({
    ticker: String(r.ticker ?? sym),
    execution_date: String(r.execution_date ?? ""),
    split_from: Number(r.split_from ?? 1),
    split_to: Number(r.split_to ?? 1),
  }));
}

// ── IPO calendar ──────────────────────────────────────────────────────────────

export type IpoEntry = {
  ticker: string;
  name: string;
  listing_date: string;
  isin: string;
  primary_exchange: string;
  share_price_low: number | null;
  share_price_high: number | null;
};

export async function fetchPolygonIpoCalendar(fromDate: string, toDate: string): Promise<IpoEntry[]> {
  const data = await polygonGet<{ results?: Array<Record<string, unknown>> }>(
    "/vX/reference/ipos",
    { "listing_date.gte": fromDate, "listing_date.lte": toDate, order: "asc", limit: "20" }
  );
  return (data?.results ?? []).map((r) => ({
    ticker: String(r.ticker ?? ""),
    name: String(r.company_name ?? r.name ?? ""),
    listing_date: String(r.listing_date ?? ""),
    isin: String(r.isin ?? ""),
    primary_exchange: String(r.primary_exchange ?? ""),
    share_price_low: r.share_price_low != null ? Number(r.share_price_low) : null,
    share_price_high: r.share_price_high != null ? Number(r.share_price_high) : null,
  }));
}
