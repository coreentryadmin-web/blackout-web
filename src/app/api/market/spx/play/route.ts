import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { getSpxPlayState } from "@/features/spx/lib/spx-service";
import { roundFloats } from "@/lib/round-floats";
import { auth as resolveAuthSession } from "@/lib/auth-server";
import { isAdminUser } from "@/lib/admin-access";
import { getSpxSimSnapshot, isSpxSimRequested, shouldServeSpxSim } from "@/lib/platform/spx-sim-desk";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  // ── ADMIN-ONLY simulation branch (fix/spx-desk-sim) — admin AND ?sim=1 only; every other
  //    caller (incl. crons, non-admins) falls through to the UNCHANGED live path below. This
  //    runs BEFORE the DB gate so the sim play renders without a live Postgres. See spx-sim-desk.ts.
  if (isSpxSimRequested(req.nextUrl.searchParams.get("sim")) && authResult.via === "user" && authResult.userId) {
    const { sessionClaims } = await resolveAuthSession();
    if (shouldServeSpxSim(await isAdminUser(authResult.userId, sessionClaims), true)) {
      const snap = await getSpxSimSnapshot();
      return NextResponse.json(roundFloats(snap.play ?? { available: false, action: "SCANNING" }), {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
          "X-Spx-Sim": "1",
        },
      });
    }
    // Non-admin passed ?sim=1 → fall through to the live member path unchanged.
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  try {
    const play = await getSpxPlayState();

    return NextResponse.json(roundFloats(play), {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    console.error("[market/spx/play]", error);
    // Return 200+degraded so a transient Massive blip (R-16) gives the client a "scanning"
    // state instead of a 502 network error that clears the play panel entirely.
    return NextResponse.json(
      { available: false, action: "SCANNING", degraded: true },
      {
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
      }
    );
  }
}
