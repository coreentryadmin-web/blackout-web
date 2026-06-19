import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { buildCronHealthSnapshot } from "@/lib/admin-cron-health";
import { recordAdminRouteError } from "@/lib/admin-route-errors";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    const snapshot = await buildCronHealthSnapshot();
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    recordAdminRouteError("admin/cron-health", error);
    return NextResponse.json({ error: "Failed to load cron health" }, { status: 502 });
  }
}
