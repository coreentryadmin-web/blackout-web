import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { loadSpxDeskPulse } from "@/features/spx/lib/spx-desk-loader";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  ensureDataSockets();
  try {
    const pulse = await loadSpxDeskPulse();
    // Same desk numbers as /spx/desk and /spx/bootstrap — round at the boundary so members never
    // see IEEE tails (7499.360000000001) on the pulse poll lane.
    return NextResponse.json(roundFloats(pulse), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    console.error("[market/spx/pulse]", error);
    return NextResponse.json({ available: false, error: "Pulse build failed" }, { status: 502 });
  }
}
