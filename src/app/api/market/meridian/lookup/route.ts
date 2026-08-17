import { NextRequest, NextResponse } from "next/server";
import { authorizePremiumDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { loadMeridianTickerLookup } from "@/lib/meridian/meridian-ticker-lookup";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authorizePremiumDeskApi(req);
  if (auth instanceof Response) return auth;

  const locked = await requireToolApi("meridian");
  if (locked) return locked;

  const ticker = req.nextUrl.searchParams.get("ticker")?.trim() ?? "";
  if (!ticker) {
    return NextResponse.json({ error: "ticker required" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const timelineRaw = req.nextUrl.searchParams.get("timeline_ids") ?? "";
  const timelineIds = timelineRaw
    ? timelineRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  try {
    const payload = await loadMeridianTickerLookup(ticker, timelineIds);
    return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[market/meridian/lookup]", error);
    return NextResponse.json({ error: "Lookup failed" }, { status: 502, headers: NO_STORE_HEADERS });
  }
}
