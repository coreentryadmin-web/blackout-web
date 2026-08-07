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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Trading days of intraday minute-bar history to fetch for the 4h view (CTO audit P2 —
 *  "4h remains open"). 12 trading days (~2.5 weeks) is enough for a meaningful multi-day 4h
 *  chart (several dozen candles) without an oversized per-request payload; see the route
 *  header comment below for why 4h needs this separate multi-day fetch instead of reusing the
 *  single-session 1m seed `bars/route.ts` serves. */
const LOOKBACK_TRADING_DAYS = 12;

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

  // Walk back from the most recent calendar day (today, or the most recent trading day when
  // today has no bars yet) one trading day at a time, collecting newest-first.
  let ymd = formatEtDate(new Date());
  const sessions: VectorOhlcBar[][] = [];
  for (let i = 0; i < LOOKBACK_TRADING_DAYS; i++) {
    const raw = await (useIndex
      ? fetchIndexMinuteBars(sym, ymd, ymd)
      : fetchStockMinuteBars(ticker, ymd, ymd)
    ).catch(() => []);

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

    ymd = previousTradingDayEt(ymd);
  }

  // Sessions were collected newest-first; emit oldest-first so the aggregator sees a strictly
  // ascending series (the same convention `fetchVectorSeedBars` uses for the intraday seed).
  const minuteBars = sessions.reverse().flat();
  const bars = aggregateMinuteTo4h(minuteBars);

  return NextResponse.json(roundFloats({ ticker, unit: "4H", bars }), { headers: NO_STORE_HEADERS });
}
