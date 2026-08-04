// GET /api/admin/zerodte/funnel — discovery funnel for Admin BIE (Phase 2b).
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { fetchZeroDteFunnelSnapshot } from "@/lib/admin-zerodte-funnel";
import { roundFloats } from "@/lib/round-floats";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    const snapshot = await fetchZeroDteFunnelSnapshot();
    return NextResponse.json(roundFloats(snapshot), { headers: NO_STORE_HEADERS });
  } catch (error) {
    recordAdminRouteError("admin/zerodte/funnel", error);
    return NextResponse.json({ error: "Failed to load 0DTE discovery funnel" }, { status: 502 });
  }
}
