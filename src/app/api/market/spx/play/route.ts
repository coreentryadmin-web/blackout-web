import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { getSpxPlayState, peekSpxPlayState } from "@/features/spx/lib/spx-service";
import {
  degradedPlayPayload,
  degradedPlayCatchingUpMessage,
  currentSessionPhase,
} from "@/features/spx/lib/spx-play-payload";
import { peekMergedSpxDesk } from "@/features/spx/lib/spx-desk-loader";
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
    //
    // BUG FIX (2026-10-21, Ask Largo/5-engine standing mandate, live repro 11:34 ET): the fix
    // above corrected the HEADLINE text but left `degradedPlayPayload()`'s hardcoded
    // `session_phase: "closed"` default untouched — the SAME false "desk is cold/closed" claim,
    // just on a different field. `spx-play-verdict-bar.ts`'s `resolveMode()` reads
    // `session_phase === "closed"` directly to decide the member-facing verdict badge, so this
    // path showed CLOSED mid-RTH: confirmed live, `GET /api/market/spx/desk` reported
    // `market_open:true`/"RTH OPEN" at the identical instant this route returned
    // `session_phase:"closed"`. Peek the desk the same cheap, non-blocking way
    // `peekMergedSpxDesk()` already serves off-path reads elsewhere (proven fast even when the
    // play-eval pipeline itself times out) and derive the real phase from it.
    //
    // 2026-10-26: the headline/idle_message literals that used to live inline here now come from
    // `degradedPlayCatchingUpMessage()` (spx-play-payload.ts) — a live audit that same day found
    // spx-service.ts's sibling degraded call site (`spxPlayReadDegraded()`) still hardcoding the
    // OLD "Desk warming" text this block fixed in 2026-10-16, because the fix only lived here as
    // inline literals with nothing forcing the other call site to match. Centralizing the message
    // means both call sites can no longer drift from each other.
    const deskPeek =
      error instanceof ServerCacheTimeoutError ? await peekMergedSpxDesk().catch(() => null) : null;
    const extras =
      error instanceof ServerCacheTimeoutError
        ? {
            ...degradedPlayCatchingUpMessage(),
            ...(deskPeek ? { session_phase: currentSessionPhase(deskPeek.merged) } : {}),
          }
        : undefined;
    return NextResponse.json(roundFloats(degradedPlayPayload(extras)), {
      headers: NO_STORE_HEADERS,
    });
  }
}
