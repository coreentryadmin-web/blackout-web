import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { buildCronHealthSnapshot } from "@/lib/admin-cron-health";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { roundFloats } from "@/lib/round-floats";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    const snapshot = await buildCronHealthSnapshot();
    // Same standing bug class: served `jobs[27].meta.baseline_accuracy_pct 39.99108337048596`
    // live on 2026-08-07. Plain 2dp — every float here is a percent or a duration, no fractions.
    return NextResponse.json(roundFloats(snapshot), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    recordAdminRouteError("admin/cron-health", error);
    return NextResponse.json({ error: "Failed to load cron health" }, { status: 502 });
  }
}
