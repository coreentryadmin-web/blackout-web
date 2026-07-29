// 0DTE Command live marks — REST fallback for the SSE lane (B-9).
// Same payload the stream pushes (one shared, per-tick-memoized build in
// src/lib/zerodte/live-marks.ts); clients poll this at 2–3s only while the
// EventSource is down. no-store: the freshness IS the product.
import { NextRequest, NextResponse } from "next/server";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { ensureZeroDteMarkPoller, getZeroDteLiveMarksJson } from "@/lib/zerodte/live-marks";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authorizeCronOrTierApi(req, "premium");
  if (auth instanceof Response) return auth;
  if (auth.via === "user") {
    const denied = await requireToolApi("nighthawk");
    if (denied) return denied;
  }

  ensureDataSockets();
  ensureZeroDteMarkPoller();

  try {
    const json = await getZeroDteLiveMarksJson();
    return new NextResponse(json, {
      headers: {
        "Content-Type": "application/json",
        ...NO_STORE_HEADERS,
      },
    });
  } catch (error) {
    console.error("[market/zerodte/marks]", error);
    return NextResponse.json(
      { available: false },
      { headers: NO_STORE_HEADERS }
    );
  }
}
