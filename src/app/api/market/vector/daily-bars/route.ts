import { NextRequest, NextResponse } from "next/server";
import { authorizePremiumDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import {
  normalizeVectorTicker,
  isVectorTickerAllowed,
  isVectorIndexTicker,
  vectorPolygonMinuteSymbol,
} from "@/features/vector/lib/vector-ticker";
import { fetchIndexDailyBars, fetchStockDailyBars } from "@/lib/providers/polygon";
import { priorEtYmd } from "@/lib/providers/spx-session";
import { formatEtDate } from "@/features/nighthawk/lib/session";
import { aggregateDailyToWeekly, isVectorDailyUnit } from "@/features/vector/lib/vector-daily-bars";
import type { VectorOhlcBar } from "@/features/vector/lib/vector-bar-timeframes";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ~2 trading years of calendar days back — comfortably covers the request's daily/weekly view
 *  without needing a second round-trip; Polygon's free daily-agg history goes back further than
 *  this, so the ceiling here is a display choice, not a provider limit. */
const LOOKBACK_DAYS = 760;

/**
 * Daily/weekly historical bars for Vector's "Daily"/"Weekly" chart view (CTO audit P2 #5) —
 * multi-day price history the intraday 1m-seeded `VectorChart` can't show (see
 * `vector-bar-timeframes.ts`'s header comment). Reuses the SAME Polygon daily-agg fetchers
 * `prior-day/route.ts` and `largo/technicals.ts` already call — no new upstream integration.
 *
 * `unit=1D` returns the raw daily bars; `unit=1W` aggregates them into Monday-anchored weekly
 * candles via the pure `aggregateDailyToWeekly`. This is price history ONLY — no GEX walls, beads,
 * or replay: those are intraday dealer-positioning concepts the daily-bar feed has no basis to
 * show, and Vector's policy is to never fabricate an overlay it can't back with real data.
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

  const rawUnit = req.nextUrl.searchParams.get("unit");
  const unit = isVectorDailyUnit(rawUnit) ? rawUnit : "1D";

  const to = formatEtDate(new Date());
  const from = priorEtYmd(LOOKBACK_DAYS);
  const sym = vectorPolygonMinuteSymbol(ticker); // I:SPX etc. for indices

  const raw = await (isVectorIndexTicker(ticker)
    ? fetchIndexDailyBars(sym, from, to, "1000")
    : fetchStockDailyBars(ticker, from, to, "1000")
  ).catch(() => []);

  const daily: VectorOhlcBar[] = raw
    .filter((b) => b.t != null && Number.isFinite(b.o) && Number.isFinite(b.c))
    .map((b) => ({
      time: Math.floor(b.t! / 1000),
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
      volume: b.v,
    }));

  const bars = unit === "1W" ? aggregateDailyToWeekly(daily) : daily;

  return NextResponse.json(roundFloats({ ticker, unit, bars }), { headers: NO_STORE_HEADERS });
}
