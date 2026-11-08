import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { dbConfigured, loadPlaybookInstanceStates } from "@/lib/db";
import { todayEt } from "@/lib/et-date";
import { parseAdminSessionDate } from "@/lib/admin-playbook-query";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/admin/playbook/fsm-today — read-only today's playbook FSM rows (F4 RTH proof). */
export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  if (!dbConfigured()) {
    return NextResponse.json(
      { available: false, reason: "database not configured" },
      { headers: NO_STORE_HEADERS }
    );
  }

  const sessionParsed = parseAdminSessionDate(req.nextUrl.searchParams.get("session"), todayEt());
  if (!sessionParsed.ok) {
    return NextResponse.json(
      { error: sessionParsed.error },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const instances = await loadPlaybookInstanceStates(sessionParsed.value);
    // Root cause (round 410 sweep): this route imported NO_STORE_HEADERS but never
    // applied it — a bare `Cache-Control: no-store` literal is missing the CDN-scoped
    // CDN-Cache-Control/Cloudflare-CDN-Cache-Control headers that are the actually
    // load-bearing ones (see the doc comment on NO_STORE_HEADERS in
    // src/lib/no-store-headers.ts). Same defect, same fix, as the 2026-11-01 audit's
    // admin/gex/health etc. correction — this sibling route was named but left
    // unfixed at the time.
    return NextResponse.json(
      {
        available: true,
        session_date: sessionParsed.value,
        as_of: new Date().toISOString(),
        instance_count: instances.length,
        instances,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    recordAdminRouteError("admin/playbook/fsm-today", error);
    return NextResponse.json(
      { error: "Failed to load playbook FSM rows" },
      { status: 502, headers: NO_STORE_HEADERS }
    );
  }
}
