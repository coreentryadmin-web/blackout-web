// GET /api/admin/zerodte/graduation — Phase 3 rail prior graduation (admin read).
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { fetchZeroDteGraduationSnapshot } from "@/lib/admin-zerodte-graduation";
import { roundFloats } from "@/lib/round-floats";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const refresh = req.nextUrl.searchParams.get("refresh") === "1";

  try {
    const snapshot = await fetchZeroDteGraduationSnapshot({ refresh });
    return NextResponse.json(roundFloats(snapshot), { headers: NO_STORE_HEADERS });
  } catch (error) {
    recordAdminRouteError("admin/zerodte/graduation", error);
    return NextResponse.json({ error: "Failed to load 0DTE rail graduation" }, { status: 502 });
  }
}
