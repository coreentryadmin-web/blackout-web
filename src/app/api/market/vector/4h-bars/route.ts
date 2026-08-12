import { NextRequest, NextResponse } from "next/server";
import { authorizePremiumDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import {
  normalizeVectorTicker,
  isVectorTickerAllowed,
  isVectorIndexTicker,
  vectorPolygonMinuteSymbol,
} from "@/features/vector/lib/vector-ticker";
import { fetchIndexMinuteBars, fetchStockMinuteBars } from "@/lib/providers/polygon";
import { formatEtDate, previousTradingDayEt } from "@/features/nighthawk/lib/session";
import { aggregateMinuteTo4h } from "@/features/vector/lib/vector-4h-bars";
import type { VectorOhlcBar } from "@/features/vector/lib/vector-bar-timeframes";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Trading days of intraday minute-bar history to fetch for the 4h view (CTO audit P2 —
 *  "4h remains open"). 12 trading days (~2.5 weeks) is enough for a meaningful multi-day 4h
 *  chart (several dozen candles) without an oversized per-request payload; see the route
 *  header comment below for why 4h needs this separate multi-day fetch instead of reusing the
 *  single-session 1m seed `bars/route.ts` serves. */
const LOOKBACK_TRADING_DAYS = 12;

/** Shared-cache namespace for the assembled 4h series. */
const CACHE_PREFIX = "vector:4h-bars";
/**
 * 4h candles change at most once every four hours, and the older sessions in the window are
 * settled history. 120s keeps the live candle responsive while removing essentially all of the
 * repeat upstream work.
 */
const CACHE_TTL_SEC = 120;

/**
 * Multi-day 4-hour bars for Vector's "4H" chart view (CTO audit P2, 2026-08-05 audit —
 * `docs/audit/VECTOR-CTO-AUDIT-2026-08-05.md`: "it needs a separate multi-day INTRADAY bar
 * feed, a materially bigger lift than the daily-close data 1D/1W reused"). The header comment
 * on `vector-bar-timeframes.ts` explains why 4h can't just be another client-side roll-up of
 * the existing intraday 1m seed: that seed (`fetchVectorSeedBars`, used by `bars/route.ts` and
 * the live SSE chart) is only ~3 trading sessions of context, and a single 6.5h RTH session
 * bucketed to 4h collapses to 1-2 candles — useless as a "4h view".
 *
 * This route instead fetches `LOOKBACK_TRADING_DAYS` of REAL intraday minute bars via the
 * EXACT SAME Polygon minute-bar fetchers (`fetchIndexMinuteBars`/`fetchStockMinuteBars`)
 * `vector-seed-bars.ts` already calls server-side for the live chart's seed — no new upstream
 * integration. It fetches one trading day at a time (Polygon's per-request row cap on these
 * fetchers is 5000; a single multi-day range call would silently truncate once
 * `LOOKBACK_TRADING_DAYS * ~390 1m bars/session` exceeds that, the same reason
 * `fetchVectorSeedBars` walks back day-by-day rather than issuing one wide-range call), then
 * concatenates the sessions oldest-first and aggregates the ascending series into ET-anchored
 * 4h candles via the pure `aggregateMinuteTo4h`.
 *
 * Like `daily-bars/route.ts`, this is price history ONLY — no GEX walls/beads/replay, and no
 * SPY-1m-volume-for-SPX backfill (that nuance is specific to the live session seed's SSE path):
 * SPX 4h candles simply carry no volume, same as its native tape has none. Vector's policy is
 * to never fabricate an overlay/series it can't back with real data.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizePremiumDeskApi(req);
  if (auth instanceof Response) return auth;

  const locked = await requireToolApi("vector");
  if (locked) return locked;

  const rawTicker = req.nextUrl.searchParams.get("ticker");
  if (!isVectorTickerAllowed(rawTicker)) {
    return NextResponse.json({ error: `Invalid ticker` }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const ticker = normalizeVectorTicker(rawTicker);
  const sym = vectorPolygonMinuteSymbol(ticker); // I:SPX etc. for indices
  const useIndex = isVectorIndexTicker(ticker);

  // Serve the assembled candles from the shared cache when they are fresh.
  //
  // WHY THIS ROUTE NEEDS A CACHE AT ALL. It pulls LOOKBACK_TRADING_DAYS of MINUTE bars —
  // ~390/session, so ~4,700 rows for SPY — and aggregates them down to ~47 4h candles. Doing that
  // per request is enormously disproportionate to the output, and it was doing exactly that:
  // `force-dynamic` + no-store + no cache meant every single page load re-fetched twelve days of
  // minute data from Polygon.
  //
  // Measured on prod 2026-08-12: 4.7s cold, 23.6s for NVDA, and 50.0s for a REPEAT call on the
  // same ticker seconds later — i.e. it got worse under its own load, because twelve serial
  // upstream calls per request contend with every other consumer of the same provider budget.
  // That is what made `/vector` a 14-second page.
  //
  // A short TTL is safe and sufficient: a 4h candle can only change once every four hours, and
  // the eleven older sessions in the window are settled history that will never change again.
  const cacheKey = `${CACHE_PREFIX}:${ticker}`;
  const cached = await sharedCacheGet<{ bars: VectorOhlcBar[] }>(cacheKey).catch(() => null);
  if (cached?.bars?.length) {
    return NextResponse.json(roundFloats({ ticker, unit: "4H", bars: cached.bars }), {
      headers: NO_STORE_HEADERS,
    });
  }

  // Resolve the trading days FIRST (the walk-back is inherently sequential — each date is derived
  // from the previous one) and only then fetch, so the twelve independent upstream calls can run
  // CONCURRENTLY instead of one after another.
  //
  // The day-by-day split itself is still required — Polygon's per-request row cap on these
  // fetchers is 5,000 and a single wide-range call would silently truncate (see the header
  // comment). But nothing ever required those calls to be SERIAL, and serialising them multiplied
  // the route's latency by twelve for no benefit.
  const ymds: string[] = [];
  let ymd = formatEtDate(new Date());
  for (let i = 0; i < LOOKBACK_TRADING_DAYS; i++) {
    ymds.push(ymd);
    ymd = previousTradingDayEt(ymd);
  }

  const settled = await Promise.all(
    ymds.map((d) =>
      (useIndex ? fetchIndexMinuteBars(sym, d, d) : fetchStockMinuteBars(ticker, d, d)).catch(
        () => []
      )
    )
  );

  // `ymds` is newest-first and Promise.all preserves input order, so `settled` is newest-first
  // too — the reverse below still yields the strictly ascending series the aggregator requires.
  const sessions: VectorOhlcBar[][] = [];
  for (const raw of settled) {
    const mapped: VectorOhlcBar[] = raw
      .filter((b) => b.t != null && Number.isFinite(b.o) && Number.isFinite(b.c))
      .map((b) => ({
        time: Math.floor(b.t! / 1000),
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
        volume: b.v,
      }));
    if (mapped.length) sessions.push(mapped);
  }

  // Sessions were collected newest-first; emit oldest-first so the aggregator sees a strictly
  // ascending series (the same convention `fetchVectorSeedBars` uses for the intraday seed).
  const minuteBars = sessions.reverse().flat();
  const bars = aggregateMinuteTo4h(minuteBars);

  // Cache only a REAL result. Writing an empty series would pin a broken response for the whole
  // TTL, turning a transient upstream blip into minutes of an empty chart.
  if (bars.length > 0) {
    await sharedCacheSet(cacheKey, { bars }, CACHE_TTL_SEC).catch(() => {});
  }

  return NextResponse.json(roundFloats({ ticker, unit: "4H", bars }), { headers: NO_STORE_HEADERS });
}
