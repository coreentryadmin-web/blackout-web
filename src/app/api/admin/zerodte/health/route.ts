// GET /api/admin/zerodte/health — small, dedicated, read-only status endpoint for
// AdminBieDashboard's "0DTE Command health" panel. Direct analogue of task #111's
// /api/admin/spx/health — same boilerplate, same admin-gating, same fail-closed
// contract — applied to the SEPARATE multi-ticker 0DTE Command scanner (`/grid`'s
// default tab), not SPX Slayer's own engine (task #127's naming disambiguation).
//
// Same admin-auth boilerplate as every other read-only admin GET (see
// /api/admin/spx/health/route.ts) — requireAdminApi() only, no actor/audit
// logging, because this route never performs an admin *action*, it only reads.
// See admin-zerodte-health.ts's module doc for exactly where each of the 3
// surfaced metrics (last-scan-time, candidates-scanned, rejection-rate) comes from.
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { fetchZeroDteHealthSnapshot } from "@/lib/admin-zerodte-health";
import { roundFloats } from "@/lib/round-floats";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    const snapshot = await fetchZeroDteHealthSnapshot();
    // Root cause (round 410 sweep): this route imported NO_STORE_HEADERS but never
    // applied it — a bare `Cache-Control: no-store` literal is missing the CDN-scoped
    // CDN-Cache-Control/Cloudflare-CDN-Cache-Control headers that are the actually
    // load-bearing ones (see the doc comment on NO_STORE_HEADERS in
    // src/lib/no-store-headers.ts), so a Cloudflare cache rule with override_origin
    // could still edge-cache this admin-only payload. Same defect, same fix, as the
    // 2026-11-01 audit's admin/gex/health, admin/helix/health, admin/cron-health and
    // admin/options-socket correction — this sibling route was named but left unfixed
    // at the time (docs/audit/findings-staging/2026-11-01-admin-health-routes-missing-cdn-nostore-headers.md).
    return NextResponse.json(roundFloats(snapshot), { headers: NO_STORE_HEADERS });
  } catch (error) {
    // fetchZeroDteHealthSnapshot() already catches every individual leg internally
    // and reports partial failures via its own `errors` field — reaching this
    // catch means something outside those guarded legs broke. Fail closed with
    // a 502 rather than a half-built JSON body; the panel's own fetch-error state
    // (AdminBieDashboard.tsx) renders "—" and never blanks the rest of the dashboard.
    recordAdminRouteError("admin/zerodte/health", error);
    return NextResponse.json(
      { error: "Failed to load 0DTE Command health snapshot" },
      { status: 502, headers: NO_STORE_HEADERS }
    );
  }
}
