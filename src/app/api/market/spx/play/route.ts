import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { getSpxPlayState } from "@/lib/platform/spx-service";
import { playMemberReadCacheSec } from "@/lib/spx-play-config";
import { withServerCache } from "@/lib/server-cache";
import { roundFloats } from "@/lib/round-floats";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  try {
    const date = todayEtYmd();
    const ttlMs = playMemberReadCacheSec() * 1000;
    const play = await withServerCache(
      `spx-play-read:${date}`,
      ttlMs,
      getSpxPlayState,
      { staleWhileRevalidate: true }
    );

    return NextResponse.json(roundFloats(play), {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    console.error("[market/spx/play]", error);
    // Return 200+degraded so a transient Massive blip (R-16) gives the client a "scanning"
    // state instead of a 502 network error that clears the play panel entirely.
    return NextResponse.json(
      { available: false, action: "SCANNING", degraded: true },
      {
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
      }
    );
  }
}
