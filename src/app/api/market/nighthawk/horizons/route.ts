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
import { getSwingServingLane } from "@/lib/swing/serving-lane";
import { requireToolApi } from "@/lib/tool-access-server";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";

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

    // SWING branch (PR-12): the 0DTE payload only carries the 0DTE lane — its SWING lane is an empty
    // placeholder. When the desk toggles to Swings, splice in the REAL sectioned serving lane (four pre-entry
    // sections live; three live-position sections empty until PR-13) BEFORE scoping, so `scopeBoardToHorizon`
    // recomputes the totals against it. `getSwingServingLane` degrades to an empty structured lane on any
    // discovery hiccup, so this stays member-safe. Other views (0DTE/LEAPS/Legacy) are untouched.
    if (horizon === "SWING") {
      const swingLane = await getSwingServingLane();
      board = { ...board, lanes: { ...board.lanes, SWING: swingLane } };
    }
    board = scopeBoardToHorizon(board, horizon);
    return NextResponse.json(
      { board, upstream_ok: payload.upstream_ok, session: payload.session },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
        },
      }
    );
  } catch (error) {
    console.error("[market/nighthawk/horizons]", error);
    return NextResponse.json(
      { available: false, degraded: true },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
    );
  }
}
