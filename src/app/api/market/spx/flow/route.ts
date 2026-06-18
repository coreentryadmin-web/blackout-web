import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { deskFlowCacheTtlMs } from "@/lib/providers/config";
import { buildSpxDeskFlow } from "@/lib/providers/spx-desk";
import { withServerCache } from "@/lib/server-cache";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";

export const dynamic = "force-dynamic";

/** Flow lane — GEX, tape, dark pool. Play state lives on /spx/play. */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  ensureDataSockets();
  try {
    const flow = await withServerCache("spx-desk-flow", deskFlowCacheTtlMs(), buildSpxDeskFlow, {
      staleWhileRevalidate: false,
    });

    return NextResponse.json(flow, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    console.error("[market/spx/flow]", error);
    return NextResponse.json({ available: false, error: "Flow build failed" }, { status: 502 });
  }
}
