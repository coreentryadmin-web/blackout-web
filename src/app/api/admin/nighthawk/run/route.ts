import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { buildEveningEdition, serializeBuildError } from "@/features/nighthawk/lib/edition-builder";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * Admin-triggered manual run of the Night Hawk edition pipeline.
 * Default: resume/recap-only rebuild only — does NOT replace an existing playbook.
 * Pass ?overwrite=1 to intentionally replace a published book (recovery).
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const overwrite = request.nextUrl.searchParams.get("overwrite") === "1";

  try {
    const result = await buildEveningEdition({ force: true, overwrite });
    const status = result.ok ? 200 : result.job_status === "failed" ? 500 : 202;
    return NextResponse.json(
      {
        ...result,
        note:
          result.job_status === "published"
            ? "Edition published."
            : "Checkpointed pipeline — click Run again to resume until published.",
      },
      { status, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    recordAdminRouteError("admin/nighthawk/run", error);
    const detail = serializeBuildError(error);
    return NextResponse.json(
      { ok: false, error: "Edition build failed", detail },
      { status: 500 }
    );
  }
}
