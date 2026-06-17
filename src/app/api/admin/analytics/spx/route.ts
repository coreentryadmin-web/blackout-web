import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { fetchSpxAdminAnalytics } from "@/lib/admin-spx-analytics";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    const analytics = await fetchSpxAdminAnalytics();
    return NextResponse.json(analytics);
  } catch (error) {
    console.error("[admin/analytics/spx]", error);
    return NextResponse.json({ error: "Failed to load SPX analytics" }, { status: 502 });
  }
}
