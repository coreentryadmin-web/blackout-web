import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { getSpxPlayState, peekSpxPlayState } from "@/features/spx/lib/spx-service";
import { degradedPlayPayload } from "@/features/spx/lib/spx-play-payload";
import { ServerCacheTimeoutError } from "@/lib/server-cache";
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
    //
    // BUG (found live 2026-10-16, Ask Largo standing mandate): a ServerCacheTimeoutError here
    // means getSpxPlayState()'s own cache/fallback chain couldn't finish within its maxBlockMs
    // budget — it is NOT evidence the underlying desk has no data. Confirmed live: a parallel
    // GET /api/market/spx/desk call at the identical millisecond returned a real, current
    // price/VIX snapshot while this route was throwing. degradedPlayPayload()'s default
    // "Desk warming — play state unavailable" headline asserts the DESK is cold, which was
    // false in every confirmed case — only the play-eval pipeline failed to produce (or find a
    // cached/peer) result in time. Keep `assessed: false` (honest: nothing was computed on this
    // path either way) but use language that doesn't claim a fact about the desk this path never
    // actually checked.
    const extras =
      error instanceof ServerCacheTimeoutError
        ? {
            headline: "Play scan still catching up — retry shortly",
            idle_message: "Play scan still catching up — retry shortly",
          }
        : undefined;
    return NextResponse.json(roundFloats(degradedPlayPayload(extras)), {
      headers: NO_STORE_HEADERS,
    });
  }
}
