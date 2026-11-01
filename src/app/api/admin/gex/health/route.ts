// GET /api/admin/gex/health — small, dedicated, read-only status endpoint for
// AdminBieDashboard's "Thermal health" panel (task #138). Same shape/contract as
// /api/admin/spx/health (task #111): requireAdminApi() only — no actor/audit logging,
// because this route never performs an admin ACTION, it only reads (see
// src/lib/admin-gex-health.ts's module doc for the full read-only proof of every leg it
// pulls from) — roundFloats on the JSON body (systemic float-rounding convention, see
// CLAUDE.md's "Data-correctness notes learned"), and a 502 fail-closed on anything that
// escapes fetchGexHealthSnapshot's own per-leg try/catch (that function's `errors` field
// already reports partial failures with a 200, same contract as admin-spx-health.ts).
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { fetchGexHealthSnapshot } from "@/lib/admin-gex-health";
import { roundFloats } from "@/lib/round-floats";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    const snapshot = await fetchGexHealthSnapshot();
    // Root cause (2026-11-01 audit): this route imported NO_STORE_HEADERS but never
    // applied it — a bare `Cache-Control: no-store` is missing the CDN-scoped
    // CDN-Cache-Control/Cloudflare-CDN-Cache-Control headers that are the actually
    // load-bearing ones (see the doc comment on NO_STORE_HEADERS), so a Cloudflare
    // cache rule with override_origin could still edge-cache this response. Same
    // defect, same fix, as the 2026-08-01 audit's admin/spx/health and
    // admin/analytics/x correction — this sibling route was missed at the time.
    return NextResponse.json(roundFloats(snapshot), { headers: NO_STORE_HEADERS });
  } catch (error) {
    recordAdminRouteError("admin/gex/health", error);
    return NextResponse.json({ error: "Failed to load GEX health snapshot" }, { status: 502, headers: NO_STORE_HEADERS });
  }
}
