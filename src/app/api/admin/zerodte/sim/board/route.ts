// ADMIN-ONLY 0DTE simulation ingest (feat/zerodte-admin-sim-view).
//
// Seeds the ISOLATED sim board snapshot (`zerodte:board:snapshot:sim:v1`) that the
// admin sim view reads. Members can never reach this route (requireAdminApi → 401/403)
// and it writes ONLY the sim key — never the member snapshot. See zerodte-sim-board.ts
// for the full three-layer isolation contract.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import {
  clearSimBoardSnapshot,
  isZeroDteBoardPayload,
  writeSimBoardSnapshot,
} from "@/lib/platform/zerodte-sim-board";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

const noStore = NO_STORE_HEADERS;

/** POST a single ZeroDteBoardPayload frame → written verbatim to the sim key (short TTL).
 *  Rejects malformed frames (400) so a bad body can never be rendered. `?reset=1` (or an
 *  empty/`{reset:true}` body) clears the sim key instead of writing. */
export async function POST(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    if (req.nextUrl.searchParams.get("reset") === "1") {
      const cleared = await clearSimBoardSnapshot();
      return NextResponse.json({ ok: true, reset: true, ...cleared }, { headers: noStore });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400, headers: noStore });
    }

    if (body && typeof body === "object" && (body as Record<string, unknown>).reset === true) {
      const cleared = await clearSimBoardSnapshot();
      return NextResponse.json({ ok: true, reset: true, ...cleared }, { headers: noStore });
    }

    if (!isZeroDteBoardPayload(body)) {
      return NextResponse.json(
        { ok: false, error: "Body is not a valid ZeroDteBoardPayload" },
        { status: 400, headers: noStore }
      );
    }

    const written = await writeSimBoardSnapshot(body);
    return NextResponse.json({ ok: true, ...written }, { headers: noStore });
  } catch (error) {
    recordAdminRouteError("admin/zerodte/sim/board", error);
    return NextResponse.json({ ok: false, error: "Sim ingest failed" }, { status: 500, headers: noStore });
  }
}

/** DELETE — clear the sim key (reset the sim view to the empty board). */
export async function DELETE() {
  const denied = await requireAdminApi();
  if (denied) return denied;
  try {
    const cleared = await clearSimBoardSnapshot();
    return NextResponse.json({ ok: true, reset: true, ...cleared }, { headers: noStore });
  } catch (error) {
    recordAdminRouteError("admin/zerodte/sim/board", error);
    return NextResponse.json({ ok: false, error: "Sim reset failed" }, { status: 500, headers: noStore });
  }
}
