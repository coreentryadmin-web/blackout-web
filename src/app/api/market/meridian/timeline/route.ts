import { NextRequest, NextResponse } from "next/server";
import { authorizePremiumDeskApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { serverCache } from "@/lib/server-cache";
import {
  loadMeridianTimelineResponse,
  MERIDIAN_TIMELINE_TTL_MS,
} from "@/lib/meridian/meridian-snapshot";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

const DEFAULT_DAYS = 14;
const MAX_DAYS = 45;

export async function GET(req: NextRequest) {
  const auth = await authorizePremiumDeskApi(req);
  if (auth instanceof Response) return auth;

  const locked = await requireToolApi("meridian");
  if (locked) return locked;

  const rawDays = Number(req.nextUrl.searchParams.get("days") ?? DEFAULT_DAYS);
  const daysAhead = Number.isFinite(rawDays)
    ? Math.min(MAX_DAYS, Math.max(1, Math.floor(rawDays)))
    : DEFAULT_DAYS;
  const skipEnrich = req.nextUrl.searchParams.get("skip_enrich") === "1";

  try {
    const today = todayEtYmd();
    const payload = await serverCache(
      `meridian:timeline:v1:${today}:${daysAhead}:${skipEnrich ? "lite" : "full"}`,
      MERIDIAN_TIMELINE_TTL_MS,
      () => loadMeridianTimelineResponse(daysAhead, { skipEnrich })
    );
    return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[market/meridian/timeline]", error);
    return NextResponse.json({ error: "Timeline failed" }, { status: 502, headers: NO_STORE_HEADERS });
  }
}
