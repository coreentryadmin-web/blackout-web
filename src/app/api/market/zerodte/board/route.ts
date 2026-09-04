// 0DTE Command board — the member-facing read of the ALWAYS-ON scanner (see
// src/lib/platform/zerodte-service.ts). A standalone product: the page shows ONLY
// the hunt — fresh single-name 0DTE finds and the graded session ledger.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth-server";
import { isAdminUser } from "@/lib/admin-access";
import { requireDatabaseInProduction } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { getZeroDteBoardPayload } from "@/lib/platform/zerodte-service";
import {
  getSimBoardPayload,
  isSimRequested,
  shouldServeSimBoard,
} from "@/lib/platform/zerodte-sim-board";
import { requireToolApi } from "@/lib/tool-access-server";
import { roundFloats } from "@/lib/round-floats";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  if (authResult.via === "user") {
    // 0DTE Command now lives on /nighthawk and follows Night Hawk's single launch
    // gate — its own LAUNCHED_0DTE kill-switch was retired (see tool-access.ts).
    const nighthawkDenied = await requireToolApi("nighthawk");
    if (nighthawkDenied) return nighthawkDenied;
  }

  // ── ADMIN-ONLY simulation branch (feat/zerodte-admin-sim-view) ────────────────────
  // Serve the ISOLATED sim snapshot ONLY when BOTH hold: the requester is a signed-in
  // ADMIN and the request opted in with `?sim=1`. Every other case — no `?sim=1`, a
  // non-admin (even passing `?sim=1`), or a cron caller — falls straight through to the
  // UNCHANGED member path below. This is the ONLY code that consults the sim key on the
  // read side; members can never trip it (admin gate) and never request it (opt-in
  // param). See src/lib/platform/zerodte-sim-board.ts for the full isolation contract.
  if (isSimRequested(req.nextUrl.searchParams.get("sim")) && authResult.via === "user" && authResult.userId) {
    const { sessionClaims } = await auth();
    const isAdmin = await isAdminUser(authResult.userId, sessionClaims);
    if (shouldServeSimBoard(isAdmin, true)) {
      ensureDataSockets();
      const simPayload = roundFloats(await getSimBoardPayload());
      return NextResponse.json(simPayload, {
        headers: {
          ...NO_STORE_HEADERS,
          "X-Zerodte-Sim": "1",
        },
      });
    }
    // Non-admin passed ?sim=1 → deliberately fall through to the member board unchanged.
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  ensureDataSockets();
  try {
    const payload = roundFloats(await getZeroDteBoardPayload());
    return NextResponse.json(payload, {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    console.error("[market/zerodte/board]", error);
    return NextResponse.json(
      { available: false, degraded: true },
      { headers: NO_STORE_HEADERS }
    );
  }
}
