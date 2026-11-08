import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { getNighthawkPublishPreview } from "@/features/nighthawk/lib/publish-preview";
import { normalizeIsoDateInput } from "@/lib/db";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  // `edition_for` flows into `WHERE edition_for = $1::date`. A non-ISO value (e.g. the legacy
  // "Mon Jun 29" label) would make Postgres throw → a 502 + error-sink record for bad CLIENT input.
  // Reject it up front with a clean 400 instead (#77 Bug 1, inbound twin).
  const rawEditionFor = request.nextUrl.searchParams.get("edition_for")?.trim();
  let editionFor: string | undefined;
  if (rawEditionFor) {
    const normalized = normalizeIsoDateInput(rawEditionFor);
    if (!normalized) {
      return NextResponse.json(
        { error: "Invalid edition_for; expected YYYY-MM-DD" },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }
    editionFor = normalized;
  }

  try {
    const preview = await getNighthawkPublishPreview(editionFor);
    if (!preview) {
      return NextResponse.json(
        { error: "No edition found" },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }
    // Root cause (round 410 sweep): this route imported NO_STORE_HEADERS but never
    // applied it — a bare `Cache-Control: no-store` literal is missing the CDN-scoped
    // CDN-Cache-Control/Cloudflare-CDN-Cache-Control headers that are the actually
    // load-bearing ones (see the doc comment on NO_STORE_HEADERS in
    // src/lib/no-store-headers.ts), so a Cloudflare cache rule with override_origin
    // could still edge-cache this admin-only payload. Same defect, same fix, as the
    // 2026-11-01 audit's admin/gex/health etc. correction — this sibling route was
    // named but left unfixed at the time.
    return NextResponse.json(preview, {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    recordAdminRouteError("admin/nighthawk/publish-preview", error);
    return NextResponse.json(
      { error: "Failed to load publish preview" },
      { status: 502, headers: NO_STORE_HEADERS }
    );
  }
}
