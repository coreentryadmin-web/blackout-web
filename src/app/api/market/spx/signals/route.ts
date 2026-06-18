import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { fetchRecentSpxSignals } from "@/lib/providers/spx-signal-log";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 50)));
    const rows = await fetchRecentSpxSignals(limit);
    return NextResponse.json({ rows });
  } catch (error) {
    console.error("[market/spx/signals]", error);
    return NextResponse.json({ rows: [], error: "Failed to load signals" }, { status: 502 });
  }
}
