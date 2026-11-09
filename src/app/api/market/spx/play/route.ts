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
    console.error(
      "[market/spx/play]",
      error instanceof ServerCacheTimeoutError ? "(cache/fallback chain timeout)" : "(eval pipeline threw)",
      error
    );
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
    //
    // BUG FIX (2026-11-09, Ask Largo/5-engine standing mandate, live repro 2026-11-09T15:35:46-48Z
    // during RTH): every fix above gated the honest override on `error instanceof
    // ServerCacheTimeoutError` specifically. That class is thrown ONLY when withServerCache's own
    // maxBlockMs/fallback race is exhausted with nothing usable to serve (server-cache.ts) — it is
    // NOT what reaches this catch block when getSpxPlayState()'s eval chain throws a REAL error
    // fast (most plausibly a provider fetch inside evaluateSpxPlayState() -> loadMergedSpxDesk()/
    // buildSpxDesk() rejecting on a 403 "not entitled" response — see CLAUDE.md's 2026-11-07/08
    // notes on the ongoing Polygon/Massive real-time-snapshot entitlement outage). A fetch that
    // rejects in well under playMemberReadMaxBlockMs() (800ms default) wins withServerCache's
    // internal Promise.race before ServerCacheTimeoutError's own timeout path ever engages, so the
    // raw error propagates here unwrapped and `instanceof ServerCacheTimeoutError` is false — this
    // route fell straight through to degradedPlayPayload()'s bare defaults, the exact same false
    // "desk is cold/closed" claim the three fixes above already removed, just reachable through a
    // gap in error TYPE rather than error TIMING. Confirmed live: this route returned the bare
    // "Desk warming"/session_phase:"closed" defaults while a parallel GET /api/market/spx/desk
    // call at the same instant reported market_open:true/"RTH OPEN"/price:7352.9. Reaching this
    // catch block always means the same thing regardless of why — "nothing was computed on this
    // path" — never "the desk/session is closed," so apply the honest override unconditionally
    // (matching spx-service.ts's spxPlayReadDegraded(), which already does this unconditionally
    // for its own distinct lock-contention trigger) instead of gating it on one named error
    // subclass. The ServerCacheTimeoutError check above is now diagnostic-only (CloudWatch
    // triage), not a gate on correctness.
    const deskPeek = await peekMergedSpxDesk().catch(() => null);
    const extras = {
      ...degradedPlayCatchingUpMessage(),
      ...(deskPeek ? { session_phase: currentSessionPhase(deskPeek.merged) } : {}),
    };
    return NextResponse.json(roundFloats(degradedPlayPayload(extras)), {
      headers: NO_STORE_HEADERS,
    });
  }
}
