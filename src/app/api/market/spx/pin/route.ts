import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { loadSpxPinForecast } from "@/features/spx/lib/spx-desk-loader";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

/** EOD Pin Forecaster — live 0DTE close projection (analytic base + Monte-Carlo overlay). */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  ensureDataSockets();
  try {
    const pin = await loadSpxPinForecast();
    return NextResponse.json(roundFloats(pin), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    console.error("[market/spx/pin]", error);
    return NextResponse.json({ available: false, error: "Pin forecast build failed" }, { status: 502 });
  }
}
