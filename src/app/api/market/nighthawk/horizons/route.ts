// Night Hawk three-board (0DTE / Swing / LEAPS) — the unified remodel read that replaces the separate
// "Today's plays" / "Tonight's playbook" surfaces. The ZERO_DTE lane is the live, proven 0DTE engine
// (getZeroDteBoardPayload) adapted into the uniform HorizonPlay shape; SWING / LEAPS come online as the
// whole-market discovery lanes ship (they render as empty lanes until then, never omitted).
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction, fetchOpenSwingPositions } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { getZeroDteBoardPayload } from "@/lib/platform/zerodte-service";
import { scopeBoardToHorizon } from "@/lib/horizon-board";
import { horizonForView, parseNightHawkView } from "@/features/nighthawk/lib/nighthawk-view";
import { horizonBoardFromZeroDtePayload } from "@/lib/zerodte/horizon-board-from-payload";
import { getSwingServingLane, discoverSwingFromPersisted, readSwingServingSnapshot } from "@/lib/swing/serving-lane";
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

    // SWING branch: persisted discovery lane + OPEN ledger rows for live sections. Cache-reader on
    // providers (spots come from the serving snapshot); DB open-book read is the member board's job.
    const snap = await readSwingServingSnapshot().catch(() => null);
    const swingLane = await getSwingServingLane({
      discover: discoverSwingFromPersisted,
      fetchOpenPositions: () => fetchOpenSwingPositions().catch(() => []),
      spotsByTicker: snap?.spotsByTicker,
    });
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
