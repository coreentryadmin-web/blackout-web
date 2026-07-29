// Night Hawk three-board (0DTE / Swing / LEAPS) — the unified remodel read that replaces the separate
// "Today's plays" / "Tonight's playbook" surfaces. The ZERO_DTE lane is the live, proven 0DTE engine
// (getZeroDteBoardPayload) adapted into the uniform HorizonPlay shape; SWING / LEAPS come online as the
// whole-market discovery lanes ship (they render as empty lanes until then, never omitted).
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { getZeroDteBoardPayload } from "@/lib/platform/zerodte-service";
import { scopeBoardToHorizon } from "@/lib/horizon-board";
import { horizonForView, parseNightHawkView } from "@/features/nighthawk/lib/nighthawk-view";
import { horizonBoardFromZeroDtePayload } from "@/lib/zerodte/horizon-board-from-payload";
import { getSwingServingLane, discoverSwingFromPersisted } from "@/lib/swing/serving-lane";
import { requireToolApi } from "@/lib/tool-access-server";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  // Same single launch gate as the 0DTE Command board — Night Hawk owns the kill-switch.
  if (authResult.via === "user") {
    const nighthawkDenied = await requireToolApi("nighthawk");
    if (nighthawkDenied) return nighthawkDenied;
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  ensureDataSockets();
  try {
    // Toggle scoping: ?view=0dte|swings|leaps|legacy (or ?horizon=) narrows the payload to one lane so the
    // whole desk shows the selected horizon. Absent → the full board (all lanes). LEGACY has no horizon
    // lane here (it's served by the separate evening-edition route), so it scopes to an all-empty board.
    const viewParam = req.nextUrl.searchParams.get("view") ?? req.nextUrl.searchParams.get("horizon");
    const horizon = viewParam ? horizonForView(parseNightHawkView(viewParam)) : null;
    const payload = await getZeroDteBoardPayload();
    let board = horizonBoardFromZeroDtePayload(payload, payload.as_of);

    // SWING branch (PR-12 + 2026-07-29 fix): ALWAYS splice the persisted serving lane into the board —
    // not only when `?view=swings`. The 0DTE payload's SWING lane is an empty placeholder; members on the
    // default (all-lanes) desk were seeing a permanently empty Swing rail even when discovery had written
    // a snapshot. `getSwingServingLane` degrades to an empty structured lane on any discovery hiccup.
    const swingLane = await getSwingServingLane({ discover: discoverSwingFromPersisted });
    board = { ...board, lanes: { ...board.lanes, SWING: swingLane } };
    board = scopeBoardToHorizon(board, horizon);
    // roundFloats at the boundary: the 0DTE lane is already rounded inside zerodte-service,
    // but the SWING lane is spliced in raw from getSwingServingLane() and the board totals are
    // re-derived here (scopeBoardToHorizon) without rounding — so raw provider floats (e.g.
    // 7499.360000000001) could leak into the horizon board once swings ship. Rounding the whole
    // payload at the response edge is the same backstop every sibling market route applies and
    // touches no computed value (roundFloats only trims IEEE float noise on numbers).
    return NextResponse.json(
      roundFloats({ board, upstream_ok: payload.upstream_ok, session: payload.session }),
      {
        headers: NO_STORE_HEADERS,
      }
    );
  } catch (error) {
    console.error("[market/nighthawk/horizons]", error);
    return NextResponse.json(
      { available: false, degraded: true },
      { headers: NO_STORE_HEADERS }
    );
  }
}
