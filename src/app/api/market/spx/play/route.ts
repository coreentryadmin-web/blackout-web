import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { getSpxPlayState, peekSpxPlayState } from "@/features/spx/lib/spx-service";
import { degradedPlayPayload } from "@/features/spx/lib/spx-play-payload";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  try {
    const instant = await peekSpxPlayState();
    if (instant) {
      void getSpxPlayState().catch(() => undefined);
      return NextResponse.json(roundFloats(instant), {
        headers: NO_STORE_HEADERS,
      });
    }
    const play = await getSpxPlayState();

    return NextResponse.json(roundFloats(play), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    console.error("[market/spx/play]", error);
    // Return 200+degraded so a transient Massive blip (R-16) gives the client a "scanning"
    // state instead of a 502 network error that clears the play panel entirely.
    return NextResponse.json(roundFloats(degradedPlayPayload()), {
      headers: NO_STORE_HEADERS,
    });
  }
}
