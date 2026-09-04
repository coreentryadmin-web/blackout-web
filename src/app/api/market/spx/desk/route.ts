import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { loadSpxDesk, peekSpxDesk } from "@/features/spx/lib/spx-desk-loader";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  ensureDataSockets();
  try {
    const instant = await peekSpxDesk();
    // Bootstrap fast-lane / pulse-minimal shells cache price:0 — serving them on peek would
    // flash SPX 0 on cold cache while gex-heatmap already has a live spot (platform-integrity FAIL).
    if (instant && instant.price > 0) {
      return NextResponse.json(
        roundFloats({ ...instant, polled_at: instant.polled_at ?? instant.as_of }),
        { headers: NO_STORE_HEADERS }
      );
    }
    // loadSpxDesk() is THE single cache lane for buildSpxDesk() — shared with
    // /api/market/spx/play and /api/admin/spx/dashboard (via loadMergedSpxDesk) so the
    // member dashboard and the trade-alert panel can never diverge on a race between two
    // independently-keyed caches. Do not call withServerCache/buildSpxDesk directly here.
    const desk = await loadSpxDesk();
    // ISSUE-29: Do NOT overwrite polled_at with the HTTP response time — that hides
    // how stale the cached data is. Pass desk.polled_at if set, otherwise desk.as_of.
    return NextResponse.json(
      roundFloats({ ...desk, polled_at: desk.polled_at ?? desk.as_of }),
      {
        headers: NO_STORE_HEADERS,
      }
    );
  } catch (error) {
    console.error("[market/spx/desk]", error);
    return NextResponse.json({ available: false, error: "Desk build failed" }, { status: 502 });
  }
}
