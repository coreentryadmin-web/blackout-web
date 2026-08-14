import { NextRequest, NextResponse } from "next/server";
import { authorizePremiumDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { isVectorTickerAllowed, normalizeVectorTicker } from "@/features/vector/lib/vector-ticker";
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
  const auth = await authorizePremiumDeskApi(req);
  if (auth instanceof Response) return auth;

  const locked = await requireToolApi("vector");
  if (locked) return locked;

  const rawTicker = req.nextUrl.searchParams.get("ticker") ?? "SPX";
  if (!isVectorTickerAllowed(rawTicker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const payload = await loadDailyRegime(
    normalizeVectorTicker(rawTicker),
    req.nextUrl.searchParams.get("days") ?? undefined
  );
  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}
