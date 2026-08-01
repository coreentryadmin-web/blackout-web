import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { fetchXAdminAnalytics } from "@/lib/admin-x-analytics";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    const analytics = await fetchXAdminAnalytics();
    // Root cause (2026-08-01 audit): this route imported NO_STORE_HEADERS but never
    // applied it — a bare `Cache-Control: no-store` is missing the CDN-scoped
    // CDN-Cache-Control/Cloudflare-CDN-Cache-Control headers that are the actually
    // load-bearing ones (see the doc comment on NO_STORE_HEADERS), so a Cloudflare
    // cache rule with override_origin could still edge-cache this response.
    return NextResponse.json(roundFloats(analytics), { headers: NO_STORE_HEADERS });
  } catch (error) {
    recordAdminRouteError("admin/analytics/x", error);
    return NextResponse.json(
      { error: "Failed to load X marketing analytics" },
      { status: 502 },
    );
  }
}
