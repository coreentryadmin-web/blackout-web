import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/market/gex-heatmap?ticker=SPY
 *
 * Returns the server-cached dealer GEX heatmap (strike × expiry net dollar-gamma
 * matrix). The matrix is computed ONCE in fetchGexHeatmap and shared (in-memory +
 * Redis) across all callers — this route never triggers a per-user upstream chain
 * fetch. Premium Clerk session OR cron secret, matching the other market desk routes.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  const ticker = (req.nextUrl.searchParams.get("ticker") || "SPY").toUpperCase();

  try {
    const heatmap = await fetchGexHeatmap(ticker);
    if (!heatmap) {
      // Polygon unavailable / empty chain — never fabricate. Client renders empty state.
      return NextResponse.json(
        { available: false, underlying: ticker },
        {
          status: 200,
          headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
        }
      );
    }
    return NextResponse.json(
      { available: true, ...heatmap },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
        },
      }
    );
  } catch (error) {
    console.error("[market/gex-heatmap]", error);
    return NextResponse.json(
      { available: false, error: "GEX heatmap build failed" },
      { status: 502 }
    );
  }
}
