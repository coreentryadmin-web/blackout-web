import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { loadSpxDeskFlow } from "@/features/spx/lib/spx-desk-loader";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { roundFloats } from "@/lib/round-floats";

export const dynamic = "force-dynamic";

/** Flow lane — GEX, tape, dark pool. Play state lives on /spx/play. */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  ensureDataSockets();
  try {
    const flow = await loadSpxDeskFlow();

    // Round at the data layer, like every sibling SPX route. This was the ONE that did not:
    // measured live 2026-08-07, 14 field paths served raw IEEE-754 on all four polls
    // (net_gex -1478892837.029604, gamma 46071.269100000005) while the other ten SPX endpoints
    // were clean. Members read these numbers; a 15-significant-digit tail is noise that looks
    // like precision.
    return NextResponse.json(roundFloats(flow), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    console.error("[market/spx/flow]", error);
    return NextResponse.json({ available: false, error: "Flow build failed" }, { status: 502 });
  }
}
