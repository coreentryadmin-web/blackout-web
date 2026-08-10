import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { loadDailyRegime } from "@/features/vector/lib/vector-daily-regime-server";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

/**
 * GET /api/market/vector/daily-regime?ticker=SPX&days=15
 *
 * End-of-session dealer gamma flip + primary call/put wall, one row per recorded session, for the
 * historical (1D/1W/4H) chart's regime overlay.
 *
 * The walk, the chunking, the shared cache and the retention disclosure all live in
 * `vector-daily-regime-server.ts` — this route is auth + parameter plumbing over that one
 * derivation, so Largo's `get_vector_analytics` and the chart cannot drift apart or answer from
 * two differently-tuned copies of the same walk.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  const payload = await loadDailyRegime(
    req.nextUrl.searchParams.get("ticker") ?? "SPX",
    req.nextUrl.searchParams.get("days") ?? undefined
  );
  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}
