import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { fetchNighthawkAdminAnalytics } from "@/lib/admin-nighthawk-analytics";
import { recordAdminRouteError } from "@/lib/admin-route-errors";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    const analytics = await fetchNighthawkAdminAnalytics();
    return NextResponse.json(analytics);
  } catch (error) {
    recordAdminRouteError("admin/nighthawk/analytics", error);
    return NextResponse.json({ error: "Failed to load Night Hawk analytics" }, { status: 502 });
  }
}
