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
import { roundFloats, reconcileTrancheFractions } from "@/lib/round-floats";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

/**
 * Per-key wire precision for this route's two option-greeks blocks — `setups[].plan.greeks`
 * (plan.ts's buildContractPlan: `greeks: input.greeks`, never rounded upstream) and
 * `ledger[].greeks` (zerodte-service.ts: `greeks: liveMark?.greeks ?? null`, straight off the
 * raw 1s live-mark store). Both are genuinely unrounded all the way up the pipeline, so the
 * flat 2dp default this route applied via a bare `roundFloats(payload)` call would silently
 * DESTROY a real small greek to 0.00 (round-floats.ts's own header: "gamma is routinely
 * 0.0008-0.05 ... the 2dp default would quantize it to 0.00"). Found live 2026-10-26 (Ask
 * Largo standing audit mandate): this is the SAME `ZeroDteGreeks`/`ContractGreeks` field set
 * (Δ Γ Θ V IV) the sibling GET /api/market/zerodte/marks route already protects with
 * live-marks.ts's `ZERODTE_MARKS_WIRE_DP` — this route never got the matching override, even
 * though it serves the exact same 0DTE instrument. Values copied verbatim from that constant
 * (not imported — live-marks.ts pulls in the WS/Redis mark-poller import graph this route's
 * tests deliberately stay free of, same discipline zerodte-service.ts's own lazy dynamic
 * import of live-marks.ts documents) so a board/record read and a marks read of the same
 * contract always render identically: gamma/vega 6dp (SPY 0DTE gamma is commonly ~0.0008, so
 * even 4dp would collapse it to one significant figure), delta/theta/iv 4dp.
 */
const ZERODTE_BOARD_GREEKS_WIRE_DP = {
  delta: 4,
  theta: 4,
  iv: 4,
  gamma: 6,
  vega: 6,
};

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
    const payload = roundFloats(await getZeroDteBoardPayload(), 2, ZERODTE_BOARD_GREEKS_WIRE_DP);
    // Same rounding-composition bug + fix as the record route's entry_context.executable.tranches
    // reconciliation (round-floats.ts's reconcileTrancheFractions doc comment has the full
    // write-up): `ledger[].timeline_tranches` is the SAME WS-11 per-leg array
    // (readTimelineTranchesFromEntryContext reads it off the identical entry_context.executable
    // blob), independently re-rounded here by roundFloats() above, so it carries the identical
    // defect — a fully-fired ⅓/⅓/⅓ trim_scale row shows legs summing to 0.99, not 1.00.
    for (const row of payload.ledger) {
      row.timeline_tranches = reconcileTrancheFractions(row.timeline_tranches) ?? null;
    }
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
