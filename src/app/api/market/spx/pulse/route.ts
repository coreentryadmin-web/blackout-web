import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { loadSpxDeskPulse } from "@/features/spx/lib/spx-desk-loader";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
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
      return NextResponse.json(snap.pulse ?? { available: false }, {
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
    const pulse = await loadSpxDeskPulse();
    return NextResponse.json(pulse, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    console.error("[market/spx/pulse]", error);
    return NextResponse.json({ available: false, error: "Pulse build failed" }, { status: 502 });
  }
}
