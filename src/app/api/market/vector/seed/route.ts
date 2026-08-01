import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { normalizeVectorTicker, isVectorTickerAllowed } from "@/features/vector/lib/vector-ticker";
import { loadVectorSeedProps } from "@/features/vector/lib/vector-seed-props";
import { trimVectorSeedForTransport } from "@/features/vector/lib/vector-wall-transport";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Client seed for /vector — same pipeline as the old SSR loadVectorSeedProps, but fetched
 * after HTML so the page shell is not blocked on Polygon reconstruct and the JSON response
 * is trimmed for wire size (dominant wall depth only). Per-horizon rails load via
 * /api/market/vector/wall-history when the member toggles DTE.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  const locked = await requireToolApi("vector");
  if (locked) return locked;

  const rawTicker = req.nextUrl.searchParams.get("ticker");
  if (!isVectorTickerAllowed(rawTicker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const ticker = normalizeVectorTicker(rawTicker);

  const seed = await loadVectorSeedProps(ticker);
  return NextResponse.json(trimVectorSeedForTransport(seed), { headers: NO_STORE_HEADERS });
}
