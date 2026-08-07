import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { normalizeVectorTicker, isVectorTickerAllowed } from "@/features/vector/lib/vector-ticker";
import { fetchVectorSeedBars } from "@/features/vector/lib/vector-seed-bars";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Closed minute bars for the Vector chart — the client's SSE-reconnect
 * backfill. The SSE carries only the currently-forming candle, so any bar
 * that closed while the connection was down (reconnect crossing a minute
 * boundary, replay window, tab sleep) was previously a permanent hole in the
 * session for the rest of the day, silently corrupting higher-timeframe
 * aggregates. Clients re-seed from here on every (re)connect.
 *
 * Floats are rounded at the response boundary like every sibling Vector read. This route was the
 * last one missing it: measured live 2026-08-07, `bars?ticker=SPX` served `high` values such as
 * `7788.650000000001` (8 hits in the first 60 elements). No `keyDp` override — every fractional
 * field here is an OHLC price, for which the 2dp default is correct, and `roundFloats` already
 * short-circuits on integers so epoch timestamps and share volumes pass through untouched.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  const locked = await requireToolApi("vector");
  if (locked) return locked;

  const rawTicker = req.nextUrl.searchParams.get("ticker");
  if (!isVectorTickerAllowed(rawTicker)) {
    return NextResponse.json({ error: `Invalid ticker` }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const ticker = normalizeVectorTicker(rawTicker);

  const { bars, sessionYmd } = await fetchVectorSeedBars(ticker);
  return NextResponse.json(
    roundFloats({ ticker, sessionYmd, bars, available: bars.length > 0 }),
    { headers: NO_STORE_HEADERS }
  );
}
