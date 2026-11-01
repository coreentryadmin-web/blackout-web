// Admin status for the Night's Watch options WebSocket (live option marks).
// Lets an operator verify the engine is enabled, connected, authenticated, and
// streaming the union of held contracts — without digging through CloudWatch logs.

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { getOptionsSocketStatus } from "@/lib/ws/options-socket";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  // Boot the lazy-init sockets if they haven't started yet, so hitting this route
  // is itself a reliable way to bring the engine up + report its live state.
  ensureDataSockets();

  // Root cause (2026-11-01 audit): this route imported NO_STORE_HEADERS but never
  // applied it — a bare `Cache-Control: no-store` is missing the CDN-scoped
  // CDN-Cache-Control/Cloudflare-CDN-Cache-Control headers that are the actually
  // load-bearing ones (see the doc comment on NO_STORE_HEADERS), so a Cloudflare
  // cache rule with override_origin could still edge-cache this response. Same
  // defect, same fix, as the 2026-08-01 audit's admin/spx/health and
  // admin/analytics/x correction — this sibling route was missed at the time.
  return NextResponse.json(getOptionsSocketStatus(), {
    headers: NO_STORE_HEADERS,
  });
}
