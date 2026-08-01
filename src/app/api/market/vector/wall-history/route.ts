import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { normalizeVectorTicker, isVectorTickerAllowed } from "@/features/vector/lib/vector-ticker";
import { loadSessionWallHistory } from "@/features/vector/lib/vector-wall-persist";
import { resolveDteHorizonParam } from "@/features/vector/lib/vector-dte-horizon";
import { trimWallHistoryForTransport } from "@/features/vector/lib/vector-wall-transport";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recorded per-horizon bead trail for a session — the read behind the Vector chart's DTE toggle
 * showing FROZEN point-in-time clusters (not the single current column) for 0DTE/weekly/monthly.
 *
 * Why a dedicated read: narrowed horizons (0DTE/weekly/monthly) and the blended "all" rail are
 * recorded under composite-keyed or bare-ticker rails. Returns transport-trimmed dominant-depth
 * samples so DTE toggles and reconnect backfills stay lightweight on the wire.
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
  const horizon = resolveDteHorizonParam(req.nextUrl.searchParams);
  const session = req.nextUrl.searchParams.get("session") ?? "";

  if (!session) {
    return NextResponse.json(
      { ticker, horizon, sessionYmd: session, history: [] },
      { headers: NO_STORE_HEADERS }
    );
  }

  const history = await loadSessionWallHistory(session, ticker, horizon).catch(() => []);
  return NextResponse.json(
    {
      ticker,
      horizon,
      sessionYmd: session,
      history: trimWallHistoryForTransport(history),
    },
    { headers: NO_STORE_HEADERS }
  );
}
