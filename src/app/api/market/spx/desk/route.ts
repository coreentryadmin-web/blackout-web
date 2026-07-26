import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { loadSpxDesk } from "@/features/spx/lib/spx-desk-loader";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { roundFloats } from "@/lib/round-floats";
import { auth as resolveAuthSession } from "@/lib/auth-server";
import { isAdminUser } from "@/lib/admin-access";
import { getSpxSimSnapshot, isSpxSimRequested, shouldServeSpxSim } from "@/lib/platform/spx-sim-desk";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  // ── ADMIN-ONLY simulation branch (fix/spx-desk-sim) — admin AND ?sim=1 only; every other
  //    caller falls through to the UNCHANGED live path below. See spx-sim-desk.ts.
  if (isSpxSimRequested(req.nextUrl.searchParams.get("sim")) && auth.via === "user" && auth.userId) {
    const { sessionClaims } = await resolveAuthSession();
    if (shouldServeSpxSim(await isAdminUser(auth.userId, sessionClaims), true)) {
      const snap = await getSpxSimSnapshot();
      return NextResponse.json(roundFloats(snap.desk ?? { available: false }), {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
          "X-Spx-Sim": "1",
        },
      });
    }
    // Non-admin passed ?sim=1 → fall through to the live member path unchanged.
  }

  ensureDataSockets();
  try {
    // loadSpxDesk() is THE single cache lane for buildSpxDesk() — shared with
    // /api/market/spx/play and /api/admin/spx/dashboard (via loadMergedSpxDesk) so the
    // member dashboard and the trade-alert panel can never diverge on a race between two
    // independently-keyed caches. Do not call withServerCache/buildSpxDesk directly here.
    const desk = await loadSpxDesk();
    // ISSUE-29: Do NOT overwrite polled_at with the HTTP response time — that hides
    // how stale the cached data is. Pass desk.polled_at if set, otherwise desk.as_of.
    return NextResponse.json(
      roundFloats({ ...desk, polled_at: desk.polled_at ?? desk.as_of }),
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
        },
      }
    );
  } catch (error) {
    console.error("[market/spx/desk]", error);
    return NextResponse.json({ available: false, error: "Desk build failed" }, { status: 502 });
  }
}
