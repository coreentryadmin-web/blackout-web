import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { fetchPlaybookPromotionReport } from "@/lib/admin-playbook-promotion";
import { parseAdminSinceDate } from "@/lib/admin-playbook-query";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/admin/playbook/promotion-report — on-demand OOS promotion evidence (#20b). */
export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const sinceParam = req.nextUrl.searchParams.get("since");
  const sinceParsed = parseAdminSinceDate(sinceParam);
  if (!sinceParsed.ok) {
    return NextResponse.json(
      { error: sinceParsed.error },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const report = await fetchPlaybookPromotionReport({ since_date: sinceParsed.value });
    // Root cause (round 410 sweep): this route imported NO_STORE_HEADERS but never
    // applied it — a bare `Cache-Control: no-store` literal is missing the CDN-scoped
    // CDN-Cache-Control/Cloudflare-CDN-Cache-Control headers that are the actually
    // load-bearing ones (see the doc comment on NO_STORE_HEADERS in
    // src/lib/no-store-headers.ts). Same defect, same fix, as the 2026-11-01 audit's
    // admin/gex/health etc. correction — this sibling route was named but left
    // unfixed at the time.
    return NextResponse.json(report, {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    recordAdminRouteError("admin/playbook/promotion-report", error);
    return NextResponse.json(
      { error: "Failed to build promotion report" },
      { status: 502, headers: NO_STORE_HEADERS }
    );
  }
}
