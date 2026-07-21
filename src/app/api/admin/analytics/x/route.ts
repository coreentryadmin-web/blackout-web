import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { fetchXAdminAnalytics } from "@/lib/admin-x-analytics";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { roundFloats } from "@/lib/round-floats";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    const analytics = await fetchXAdminAnalytics();
    return NextResponse.json(roundFloats(analytics), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    recordAdminRouteError("admin/analytics/x", error);
    return NextResponse.json(
      { error: "Failed to load X marketing analytics" },
      { status: 502 },
    );
  }
}
