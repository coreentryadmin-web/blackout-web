import { NextRequest, NextResponse } from "next/server";
import { authorizePremiumDeskApi } from "@/lib/market-api-auth";
import { fetchMarketMovers, fetchSectorPerformance } from "@/lib/providers/polygon";
import { polygonConfigured } from "@/lib/providers/config";
import { serverCache, TTL } from "@/lib/server-cache";
import { requireToolApi } from "@/lib/tool-access-server";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authorizePremiumDeskApi(req);
  if (auth instanceof Response) return auth;

  // Launch gate — locked to non-admins until this tool ships.
  const locked = await requireToolApi("heatmap");
  if (locked) return locked;

  if (!polygonConfigured()) {
    return NextResponse.json(
      { error: "Market data unavailable", sectors: [], movers: [], as_of: new Date().toISOString() },
      { status: 503 }
    );
  }

  try {
    const [sectors, movers] = await Promise.all([
      serverCache("heatmap:sectors", TTL.MARKET_SNAPSHOT, () => fetchSectorPerformance()),
      serverCache("heatmap:movers:20", TTL.MARKET_SNAPSHOT, () => fetchMarketMovers(20)),
    ]);
    return NextResponse.json({
      source: "market",
      sectors,
      movers,
      as_of: new Date().toISOString(),
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[market/heatmap]", error);
    return NextResponse.json({ error: "Heatmap fetch failed" }, { status: 502 });
  }
}
