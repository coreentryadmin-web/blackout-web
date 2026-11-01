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
    //
    // Root cause (2026-11-01 audit): this route also imported NO_STORE_HEADERS but
    // never applied it — a bare `Cache-Control: no-store` is missing the CDN-scoped
    // CDN-Cache-Control/Cloudflare-CDN-Cache-Control headers that are the actually
    // load-bearing ones (see the doc comment on NO_STORE_HEADERS), so a Cloudflare
    // cache rule with override_origin could still edge-cache this response. Same
    // defect, same fix, as the 2026-08-01 audit's admin/spx/health and
    // admin/analytics/x correction — this sibling route was missed at the time.
    return NextResponse.json(roundFloats(snapshot), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    recordAdminRouteError("admin/cron-health", error);
    return NextResponse.json({ error: "Failed to load cron health" }, { status: 502, headers: NO_STORE_HEADERS });
  }
}
