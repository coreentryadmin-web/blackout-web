import { NextRequest, NextResponse } from "next/server";
import { fetchMarketFlowAlerts } from "@/lib/providers/unusual-whales";
import { uwConfigured } from "@/lib/providers/config";

export async function GET(req: NextRequest) {
  if (!uwConfigured()) {
    return NextResponse.json(
      { error: "UW_API_KEY not configured", flows: [], count: 0 },
      { status: 503 }
    );
  }

  const sp = req.nextUrl.searchParams;
  const limit = Number(sp.get("limit") ?? 50);
  const ticker = sp.get("ticker") ?? undefined;
  const min_premium = Number(sp.get("min_premium") ?? 0) || undefined;

  try {
    const flows = await fetchMarketFlowAlerts({ limit, ticker, min_premium });
    return NextResponse.json({ source: "unusual_whales", flows, count: flows.length });
  } catch (error) {
    console.error("[market/flows]", error);
    return NextResponse.json({ error: "Flow fetch failed" }, { status: 502 });
  }
}
