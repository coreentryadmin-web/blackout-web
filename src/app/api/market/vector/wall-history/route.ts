import { NextRequest, NextResponse } from "next/server";
import { authorizePremiumDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { normalizeVectorTicker, isVectorTickerAllowed } from "@/features/vector/lib/vector-ticker";
import { loadSessionWallHistory } from "@/features/vector/lib/vector-wall-persist";
import { resolveDteHorizonParam } from "@/features/vector/lib/vector-dte-horizon";
import { fetchVectorSeedBars } from "@/features/vector/lib/vector-seed-bars";
import { enrichSessionWallHistory } from "@/features/vector/lib/vector-wall-history-enrich";
import { primeVectorWallScope } from "@/features/vector/lib/vector-snapshot";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recorded per-horizon bead trail for a session — the read behind the Vector chart's DTE toggle
 * showing FROZEN point-in-time clusters (not the single current column) for 0DTE/weekly/monthly.
 *
 * Why a dedicated read: the SSR seed (`page.tsx`) loads only the blended "all" rail
 * (`loadSessionWallHistory(sessionYmd, ticker)`); the narrowed horizons are recorded under their
 * own composite-keyed rails (`NVDA::weekly`, PR #186) but were never fetched client-side, so a
 * toggle to weekly/monthly could only draw the single current-structure column. This returns the
 * full recorded trail for the requested horizon so the chart draws the accumulated clusters — the
 * after-close analogue of the live rail, per the member ask "weekly & monthly should show the
 * call/put bead clusters, static after close, not single beads."
 *
 * `session` is the ET session date the chart is displaying (from `fetchVectorSeedBars`), passed so
 * the rail and the price bars describe the SAME session and align on the time axis. Absent/`"all"`
 * horizon short-circuits to an empty trail — the "all" rail is already SSR-seeded, and there is no
 * separate composite rail to read for it.
 *
 * Blended "all" responses run through {@link enrichSessionWallHistory} (observed merge + modeled
 * gap-fill) so soft ticker switches and Compare panes match SSR — raw Redis rows alone leave
 * recorder holes as blank bands (FINDINGS 2026-08-14).
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
  const horizon = resolveDteHorizonParam(req.nextUrl.searchParams);
  const session = req.nextUrl.searchParams.get("session") ?? "";

  // A missing session can't be resolved to a rail here (the chart owns the displayed session date),
  // so return an empty trail and let the client fall back to the current-structure column.
  if (!session) {
    return NextResponse.json(
      { ticker, horizon, sessionYmd: session, history: [] },
      { headers: NO_STORE_HEADERS }
    );
  }

  const persisted = await (horizon === "all"
    ? loadSessionWallHistory(session, ticker)
    : loadSessionWallHistory(session, ticker, horizon)
  ).catch(() => []);

  let history = persisted;
  if (horizon === "all") {
    ensureDataSockets();
    await primeVectorWallScope(ticker);
    const { bars } = await fetchVectorSeedBars(ticker);
    history = await enrichSessionWallHistory({
      ticker,
      sessionYmd: session,
      persistedHistory: persisted,
      bars,
      mergeLiveMemory: true,
      decimate: true,
    });
  }

  return NextResponse.json(
    { ticker, horizon, sessionYmd: session, history },
    { headers: NO_STORE_HEADERS }
  );
}
