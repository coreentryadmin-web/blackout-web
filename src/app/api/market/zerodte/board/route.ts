// 0DTE Command board — the member-facing read of the ALWAYS-ON scanner (see
// src/lib/platform/zerodte-service.ts). A standalone product: the page shows ONLY
// the hunt — fresh single-name 0DTE finds and the graded session ledger.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth-server";
import { isAdminUser } from "@/lib/admin-access";
import { requireDatabaseInProduction } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { getZeroDteBoardPayload, ZERODTE_BOARD_WIRE_DP } from "@/lib/platform/zerodte-service";
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

// Per-key wire precision for this route's own roundFloats() pass (option greeks + condor
// calibration-bucket widths — see `ZERODTE_BOARD_WIRE_DP`'s doc comment in zerodte-service.ts
// for the two field families and why they need it).
//
// CORRECTED ROOT CAUSE (Ask Largo standing audit mandate — originally found 2026-10-26, mislocated
// here; corrected same day once an adversarial verifier traced it one layer upstream): this route
// used to define its OWN local copy of this map, added after the live repro below, believing this
// `roundFloats(await getZeroDteBoardPayload(), 2, ...)` call was where the destructive flat-2dp
// rounding happened. It was not — `getZeroDteBoardPayload()`'s underlying `buildZeroDteBoardPayload()`
// (zerodte-service.ts) had ALREADY rounded the payload at a bare dp=2 with NO per-key override
// before this route ever runs, and that rounded result is what gets cached into the shared Redis
// board snapshot every replica/consumer reads. `roundFloats()` is idempotent on an already-rounded
// value (re-rounding 0.01 at 4dp is still 0.01 — no lost precision can be recovered), so THIS call's
// own correctly-configured override was rounding numbers that were already destroyed one layer up —
// a no-op dressed up as a fix. The real fix moved the override to zerodte-service.ts's own internal
// roundFloats() call (the one that gets cached); this route now imports that single source of truth
// instead of keeping a second, driftable copy, and keeps calling roundFloats() with it here too as a
// harmless, idempotent belt-and-suspenders guard — consistent with this route's own two-layer
// defense already in place for `timeline_tranches` below.
//
// Live-confirmed 2026-10-26: SPXW's served `call_width_pct` was 0.01 on the wire (the flat 2dp
// default) while the value re-derived from the disclosed `condor_basis_price` was 0.00825 (the 92%
// win-rate calibration bucket, not whatever 0.01 implies) — collapsing the 77%/92%/96% condor
// buckets (CONDOR_WINRATE_BY_WIDTH, iron-condor.ts) onto the identical served value.

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
    const payload = roundFloats(await getZeroDteBoardPayload(), 2, ZERODTE_BOARD_WIRE_DP);
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
