import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { deskPulseCacheTtlMs } from "@/lib/providers/config";
import { buildSpxDeskPulse } from "@/lib/providers/spx-desk";
import { withServerCache } from "@/lib/server-cache";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  ensureDataSockets();
  try {
    const pulse = await withServerCache("spx-desk-pulse", deskPulseCacheTtlMs(), buildSpxDeskPulse, {
      staleWhileRevalidate: false,
    });
    return NextResponse.json(pulse, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    console.error("[market/spx/pulse]", error);
    return NextResponse.json({ available: false, error: "Pulse build failed" }, { status: 502 });
  }
}
