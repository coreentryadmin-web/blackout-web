// ADMIN-ONLY SPX Slayer desk simulation ingest (fix/spx-desk-sim).
//
// Seeds the ISOLATED sim snapshot (`spx:desk:snapshot:sim:v1`) that the admin `?sim=1` desk
// reads. Members can never reach this route (requireAdminApi → 401/403) and it writes ONLY
// the sim key — never any live SPX cache lane. See spx-sim-desk.ts for the full three-layer
// isolation contract.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import {
  clearSpxSimSnapshot,
  isSpxSimDeskBundle,
  writeSpxSimSnapshot,
} from "@/lib/platform/spx-sim-desk";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

/** POST a single SpxSimDeskBundle frame → written verbatim to the sim key (short TTL). Rejects
 *  malformed frames (400) so a bad body can never be rendered. `?reset=1` (or a `{reset:true}`
 *  body) clears the sim key instead of writing. */
export async function POST(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    if (req.nextUrl.searchParams.get("reset") === "1") {
      const cleared = await clearSpxSimSnapshot();
      return NextResponse.json({ ok: true, reset: true, ...cleared }, { headers: noStore });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400, headers: noStore });
    }

    if (body && typeof body === "object" && (body as Record<string, unknown>).reset === true) {
      const cleared = await clearSpxSimSnapshot();
      return NextResponse.json({ ok: true, reset: true, ...cleared }, { headers: noStore });
    }

    if (!isSpxSimDeskBundle(body)) {
      return NextResponse.json(
        { ok: false, error: "Body is not a valid SpxSimDeskBundle" },
        { status: 400, headers: noStore }
      );
    }

    const written = await writeSpxSimSnapshot(body);
    return NextResponse.json({ ok: true, ...written }, { headers: noStore });
  } catch (error) {
    recordAdminRouteError("admin/spx/sim/desk", error);
    return NextResponse.json({ ok: false, error: "Sim ingest failed" }, { status: 500, headers: noStore });
  }
}

/** DELETE — clear the sim key (reset the sim desk to empty). */
export async function DELETE() {
  const denied = await requireAdminApi();
  if (denied) return denied;
  try {
    const cleared = await clearSpxSimSnapshot();
    return NextResponse.json({ ok: true, reset: true, ...cleared }, { headers: noStore });
  } catch (error) {
    recordAdminRouteError("admin/spx/sim/desk", error);
    return NextResponse.json({ ok: false, error: "Sim reset failed" }, { status: 500, headers: noStore });
  }
}
