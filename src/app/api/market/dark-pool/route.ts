import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { serverCache, TTL } from "@/lib/server-cache";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { normalizeRow, type DarkPoolRow } from "./normalize";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Number(sp.get("limit") ?? 50), 100);
  const min_premium = Number(sp.get("min_premium") ?? 0) || 0;

  try {
    const rawRows = await serverCache(`dark-pool:recent:${limit}`, TTL.DARK_POOL, async () => {
      const { fetchUwDarkPoolRecent } = await import("@/lib/providers/unusual-whales");
      return fetchUwDarkPoolRecent(limit);
    });

    const prints = (Array.isArray(rawRows) ? rawRows : [])
      .map(normalizeRow)
      .filter((r): r is DarkPoolRow => r !== null)
      .filter((r) => r.premium >= min_premium)
      .sort((a, b) => b.premium - a.premium);

    return NextResponse.json({ prints, count: prints.length }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    console.error("[dark-pool]", err);
    return NextResponse.json({ prints: [], count: 0 }, { status: 503 });
  }
}
