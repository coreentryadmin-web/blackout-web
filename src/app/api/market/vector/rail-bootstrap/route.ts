import { NextRequest, NextResponse } from "next/server";
import { authorizePremiumDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { isVectorTickerAllowed } from "@/features/vector/lib/vector-ticker";
import {
  loadVectorRailBootstrap,
  resolveRailBootstrapHorizon,
} from "@/features/vector/lib/vector-rail-bootstrap";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight bead-rail bootstrap for desk embeds — decimated persisted samples only.
 * Avoids `enrichSessionWallHistory` (Polygon reconstruct) so SPX Slayer can paint a
 * session-shaped rail in parallel with the chart shell.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizePremiumDeskApi(req);
  if (auth instanceof Response) return auth;

  const locked = await requireToolApi("vector");
  if (locked) return locked;

  const rawTicker = req.nextUrl.searchParams.get("ticker");
  if (!isVectorTickerAllowed(rawTicker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const sessionYmd = req.nextUrl.searchParams.get("session") ?? "";
  if (!sessionYmd) {
    return NextResponse.json(
      { error: "session required" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const horizon = resolveRailBootstrapHorizon(req.nextUrl.searchParams.get("dte"));
  const firstBarRaw = req.nextUrl.searchParams.get("firstBar");
  const firstBarTime =
    firstBarRaw != null && Number.isFinite(Number(firstBarRaw)) ? Number(firstBarRaw) : undefined;

  const payload = await loadVectorRailBootstrap({
    ticker: rawTicker!,
    sessionYmd,
    horizon,
    firstBarTime,
  });

  if (!payload) {
    return NextResponse.json(
      { error: "Rail bootstrap is available for oracle tickers only" },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }

  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}
