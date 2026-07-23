// Night Hawk three-board (0DTE / Swing / LEAPS) — the unified remodel read that replaces the separate
// "Today's plays" / "Tonight's playbook" surfaces. The ZERO_DTE lane is the live, proven 0DTE engine
// (getZeroDteBoardPayload) adapted into the uniform HorizonPlay shape; SWING / LEAPS come online as the
// whole-market discovery lanes ship (they render as empty lanes until then, never omitted).
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { getZeroDteBoardPayload } from "@/lib/platform/zerodte-service";
import { horizonBoardFromZeroDtePayload } from "@/lib/zerodte/horizon-board-from-payload";
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
    const payload = await getZeroDteBoardPayload();
    const board = horizonBoardFromZeroDtePayload(payload, payload.as_of);
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
